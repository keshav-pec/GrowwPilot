// Birthday & Anniversary Offers, Phase 3: the monthly offer engine, date corrections, emergency withdraw and the
// front desk occasion list. PRD AT-01, AT-03, AT-04, AT-05, AT-06, AT-07, AT-08, AT-09, AT-10, AT-29, AT-30, AT-33.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Customer, Notification, OccasionCampaign, OfferEvent, OfferIssue, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { monthWindow, taskDueAt } from '../src/modules/occasions/engine/window.js';
import { runForOrg, runScheduledTick } from '../src/modules/occasions/engine/scheduler.js';
import { expireOffers } from '../src/modules/occasions/engine/expire.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
let server;
let api;
let f;
let g; // Glamour's id
const cookies = {};
const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}
async function call(who, method, path, { body, key = method === 'GET' ? null : newKey(), headers = {} } = {}) {
  const all = { 'content-type': 'application/json', cookie: cookies[who], ...headers };
  if (key) all['idempotency-key'] = key;
  const res = await fetch(`${api}${path}`, { method, headers: all, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const ist = (iso) => DateTime.fromISO(iso, { zone: 'Asia/Kolkata' }).toJSDate();
const now = DateTime.now().setZone('Asia/Kolkata');
const thisMonth = now.month;
const otherMonth = (thisMonth % 12) + 1;
let serviceIds;
let salonBirthday;
let salonAnniversary;
let bandraBirthday;

async function enable(who) {
  const settings = await call(who, 'GET', '/occasions/settings');
  await call(who, 'PUT', '/occasions/settings', { body: { enabled: true }, headers: { 'if-match': String(settings.json.version) } });
}
async function publishCampaign(who, body) {
  const created = await call(who, 'POST', '/occasions/campaigns', { body });
  expect(created.status).toBe(201);
  const published = await call(who, 'POST', `/occasions/campaigns/${created.json.campaign._id}/publish`);
  expect(published.status).toBe(200);
  return published.json.campaign;
}
const addCustomer = (name, phone, { branch = f.andheri, birthday, anniversary, orgId = g, ...rest } = {}) =>
  Customer.create({ orgId, name, phone, homeBranchId: branch._id, occasions: { birthday: birthday && { source: 'STAFF', ...birthday }, anniversary: anniversary && { source: 'STAFF', ...anniversary } }, ...rest });
const offersOf = (customer) => OfferIssue.find({ customerId: customer._id }).sort({ type: 1, year: 1 }).lean();

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Bilal', email: 'bilal@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Dev', email: 'dev@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Layla', email: 'layla@d.com', passwordHash, allBranches: true },
  ]);
  await migrateOccasions({ log: () => {} });
  serviceIds = [String(f.haircut._id), String(f.beardTrim._id), String(f.facial._id)];
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', branchOwner: 'bilal@g.com', desk: 'kavya@g.com', bandraDesk: 'dev@g.com', desert: 'layla@d.com' })) {
    cookies[who] = await login(email);
  }

  await enable('business');
  const percent = { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds };
  salonBirthday = await publishCampaign('business', { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month', rules: percent });
  salonAnniversary = await publishCampaign('business', { type: 'ANNIVERSARY', scope: 'BUSINESS_DEFAULT', name: 'Anniversary Month', rules: { discountType: 'FLAT', value: 30000, minSubtotal: 150000, serviceIds } });
  bandraBirthday = await publishCampaign('branchOwner', { type: 'BIRTHDAY', scope: 'BRANCH_ONLY', branchId: String(f.bandra._id), name: 'Bandra Birthday', rules: { ...percent, value: 2500 } });
});

afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('time rules', () => {
  it('the month runs from the 1st 00:00 to the last day 23:59:59.999 at the branch, February too', () => {
    expect(monthWindow(2030, 11, 'Asia/Kolkata')).toEqual({ validFrom: new Date('2030-10-31T18:30:00.000Z'), validUntil: new Date('2030-11-30T18:29:59.999Z') });
    expect(monthWindow(2031, 2, 'Asia/Kolkata').validUntil).toEqual(new Date('2031-02-28T18:29:59.999Z'));
    expect(monthWindow(2032, 2, 'Asia/Kolkata').validUntil).toEqual(new Date('2032-02-29T18:29:59.999Z'));
  });

  it('tasks are due at 10:00: the same day on the 1st, otherwise the next day', () => {
    expect(taskDueAt(ist('2030-11-01T01:30'), 'Asia/Kolkata')).toEqual(ist('2030-11-01T10:00'));
    expect(taskDueAt(ist('2030-11-14T16:00'), 'Asia/Kolkata')).toEqual(ist('2030-11-15T10:00'));
    expect(taskDueAt(ist('2030-11-30T22:00'), 'Asia/Kolkata')).toEqual(ist('2030-12-01T10:00'));
  });
});

describe('the monthly run', () => {
  let asha;
  let mira;
  let rohan;
  let both;
  let silent;

  beforeAll(async () => {
    asha = await addCustomer('Asha', '9700000101', { birthday: { month: 11, day: 5 } });
    mira = await addCustomer('Mira', '9700000102', { birthday: { month: 11 } }); // month only
    rohan = await addCustomer('Rohan', '9700000103', { branch: f.bandra, birthday: { month: 11, day: 20 } });
    both = await addCustomer('Both', '9700000104', { birthday: { month: 11, day: 2 }, anniversary: { month: 11, day: 25 } });
    silent = await addCustomer('Silent', '9700000105', { birthday: { month: 11, day: 9 }, marketing: { WHATSAPP: { status: 'OPTED_OUT' } } });
  });

  it('nothing happens before 01:00 on the 1st', async () => {
    await runScheduledTick(ist('2030-11-01T00:30'));
    expect(await OfferIssue.countDocuments({ year: 2030 })).toBe(0);
  });

  it('AT-01 / AT-03: from 01:00 every matching customer gets one offer for the whole month, month-only dates too', async () => {
    await runScheduledTick(ist('2030-11-01T01:30'));
    const [offer] = await offersOf(asha);
    expect(offer).toMatchObject({ type: 'BIRTHDAY', year: 2030, month: 11, day: 5, status: 'ISSUED', campaignName: 'Birthday Month', customerName: 'Asha' });
    expect(offer.validFrom).toEqual(ist('2030-11-01T00:00'));
    expect(offer.validUntil).toEqual(new Date('2030-11-30T18:29:59.999Z'));
    expect(offer.task).toMatchObject({ state: 'OPEN', kind: 'CONTACT', attempts: 0 });
    expect(offer.task.dueAt).toEqual(ist('2030-11-01T10:00'));
    expect(offer.rules).toMatchObject({ discountType: 'PERCENT', value: 1500, maxDiscount: 50000 });
    expect(await offersOf(mira)).toHaveLength(1);
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'ISSUED' })).toBe(1);
  });

  it('AT-06: running it again and again gives one offer and one task per customer', async () => {
    for (let i = 0; i < 5; i++) await runScheduledTick(ist('2030-11-01T01:40'));
    await runForOrg(g, { now: ist('2030-11-01T02:00'), force: true });
    await runForOrg(g, { now: ist('2030-11-03T12:00'), force: true });
    expect(await OfferIssue.countDocuments({ customerId: asha._id })).toBe(1);
    const [offer] = await offersOf(asha);
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'ISSUED' })).toBe(1);
  });

  it('AT-07: a branch campaign wins for its own customers', async () => {
    const [bandra] = await offersOf(rohan);
    expect(String(bandra.campaignId)).toBe(String(bandraBirthday._id));
    expect(bandra.rules.value).toBe(2500);
    const [andheri] = await offersOf(asha);
    expect(String(andheri.campaignId)).toBe(String(salonBirthday._id));
  });

  it('AT-09: both occasions in one month give two offers', async () => {
    const offers = await offersOf(both);
    expect(offers.map((o) => o.type)).toEqual(['ANNIVERSARY', 'BIRTHDAY']);
  });

  it('AT-10: no messaging permission still gives the offer', async () => {
    const [offer] = await offersOf(silent);
    expect(offer).toMatchObject({ status: 'ISSUED', canMessage: false, channels: [] });
  });

  it('expires unused offers only after the last second of the month', async () => {
    expect(await expireOffers(g, new Date('2030-11-30T18:29:59.999Z'))).toBe(0);
    const expired = await expireOffers(g, new Date('2030-11-30T18:30:00.000Z'));
    expect(expired).toBeGreaterThan(0);
    const [offer] = await offersOf(asha);
    expect(offer.status).toBe('EXPIRED');
    expect(offer.task).toMatchObject({ state: 'CLOSED', closedReason: 'EXPIRED' });
    // Next year it happens again by itself
    await runScheduledTick(ist('2031-11-01T01:05'));
    expect((await offersOf(asha)).map((o) => o.year)).toEqual([2030, 2031]);
  });
  it('AT-04: a 29 February birthday gets the whole of February in a year without one', async () => {
    const leap = await addCustomer('Leap', '9700000106', { birthday: { month: 2, day: 29 } });
    await runScheduledTick(ist('2031-02-01T03:00'));
    const [offer] = await offersOf(leap);
    expect(offer).toMatchObject({ year: 2031, month: 2, day: 29 });
    expect(offer.validUntil).toEqual(new Date('2031-02-28T18:29:59.999Z'));
  });
});

describe('AT-33: the month ends at 23:59:59 branch time, in Dubai too', () => {
  it('a Dubai salon’s offer ends at midnight Dubai time', async () => {
    await enable('desert');
    await publishCampaign('desert', { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Dubai Birthday', rules: { discountType: 'FLAT', value: 5000, minSubtotal: 0, serviceIds: [String(f.dubaiHaircut._id)] } });
    const sara = await addCustomer('Sara', '9700000201', { orgId: f.ctxDesert.orgId, branch: f.marina, birthday: { month: 11, day: 30 } });
    await runForOrg(f.ctxDesert.orgId, { now: new Date('2030-11-15T08:00:00Z'), force: true });
    const [offer] = await offersOf(sara);
    expect(offer.validUntil).toEqual(new Date('2030-11-30T19:59:59.999Z')); // 23:59:59.999 in Dubai (UTC+4)
    expect(await expireOffers(f.ctxDesert.orgId, new Date('2030-11-30T19:00:00Z'))).toBe(0); // already December in Kolkata, still November in Dubai
    expect(await expireOffers(f.ctxDesert.orgId, new Date('2030-11-30T20:00:00Z'))).toBe(1);
  });
});

describe('this month, through the screens', () => {
  let neha;

  it('AT-05: a customer added mid-month with a birthday this month gets their offer straight away', async () => {
    const res = await call('desk', 'POST', '/customers', { body: { name: 'Neha', phone: '9700000301', birthday: { month: thisMonth } } });
    expect(res.status).toBe(201);
    neha = await Customer.findById(res.json.customer._id).lean();
    const [offer] = await offersOf(neha);
    expect(offer).toMatchObject({ type: 'BIRTHDAY', year: now.year, month: thisMonth, status: 'ISSUED' });
    const expectedDue = (now.day === 1 ? now : now.plus({ days: 1 })).set({ hour: 10, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    expect(offer.task.dueAt).toEqual(expectedDue);
  });

  it('recording permission shows straight away on the offer', async () => {
    await call('desk', 'POST', `/occasions/customers/${neha._id}/consents`, { body: { channel: 'WHATSAPP', status: 'OPTED_IN', source: 'IN_SALON', agreed: true, customerAsked: true } });
    const [offer] = await offersOf(neha);
    expect(offer).toMatchObject({ canMessage: true, channels: ['WHATSAPP'] });
  });

  it('a date correction that changes this month’s unused offer must be confirmed, then replaces it', async () => {
    const id = neha._id;
    const day = await call('desk', 'PATCH', `/customers/${id}`, { body: { birthday: { month: thisMonth, day: 3 } } });
    expect(day.status).toBe(200); // a day change in the same month needs no confirmation
    expect((await offersOf(neha))[0].status).toBe('ISSUED');

    const ask = await call('desk', 'PATCH', `/customers/${id}`, { body: { birthday: { month: otherMonth } } });
    expect(ask.status).toBe(409);
    expect(ask.json.error.code).toBe('OFFER_CHANGE_NEEDS_CONFIRM');
    expect((await Customer.findById(id).lean()).occasions.birthday.month).toBe(thisMonth); // nothing saved

    const confirmed = await call('desk', 'PATCH', `/customers/${id}`, { body: { birthday: { month: otherMonth }, confirmOfferChange: true } });
    expect(confirmed.status).toBe(200);
    const [replaced] = await offersOf(neha);
    expect(replaced).toMatchObject({ status: 'SUPERSEDED', superseded: true });
    expect(replaced.task.closedReason).toBe('REPLACED');

    // Back to this month (a mistake corrected again): a new offer, as the replaced one doesn't count
    await call('desk', 'PUT', `/occasions/customers/${id}/dates`, { body: { birthday: { month: thisMonth } } });
    const offers = await offersOf(neha);
    expect(offers.map((o) => o.status).sort()).toEqual(['ISSUED', 'SUPERSEDED']);
  });

  it('a used offer’s date can change, but no second offer is given that year', async () => {
    const used = await addCustomer('Used', '9700000302', { birthday: { month: thisMonth } });
    await call('business', 'POST', '/occasions/settings/run-now');
    await OfferIssue.updateOne({ customerId: used._id }, { $set: { status: 'REDEEMED' } });
    const res = await call('desk', 'PATCH', `/customers/${used._id}`, { body: { birthday: { month: otherMonth } } });
    expect(res.status).toBe(200);
    await call('desk', 'PATCH', `/customers/${used._id}`, { body: { birthday: { month: thisMonth } } });
    expect((await offersOf(used)).map((o) => o.status)).toEqual(['REDEEMED']);
  });

  it('AT-08: moving to another branch mid-month keeps the one offer, which follows the customer', async () => {
    const mover = await addCustomer('Mover', '9700000303', { birthday: { month: thisMonth } });
    await call('business', 'POST', '/occasions/settings/run-now');
    const [before] = await offersOf(mover);
    expect(String(before.homeBranchId)).toBe(String(f.andheri._id));

    await call('business', 'PUT', `/occasions/customers/${mover._id}/dates`, { body: { homeBranchId: String(f.bandra._id) } });
    const after = await offersOf(mover);
    expect(after).toHaveLength(1);
    expect(String(after[0].homeBranchId)).toBe(String(f.bandra._id));
    expect(String(after[0].campaignId)).toBe(String(salonBirthday._id)); // keeps the terms it was given
    expect(await OfferEvent.exists({ offerId: before._id, kind: 'MOVED' })).toBeTruthy();

    // It now shows at Bandra, not at Andheri
    expect((await call('desk', 'GET', `/occasions/offers/${before._id}`)).status).toBe(404);
    expect((await call('bandraDesk', 'GET', `/occasions/offers/${before._id}`)).status).toBe(200);
  });
});

describe('the occasion list', () => {
  it('the front desk sees only their branch, with tiles and filters done in the database', async () => {
    const list = await call('desk', 'GET', '/occasions/offers?tab=all');
    expect(list.status).toBe(200);
    expect(list.json.month).toBe(thisMonth);
    expect(list.json.offers.length).toBeGreaterThan(0);
    expect(list.json.offers.every((o) => o.homeBranchName === 'Andheri')).toBe(true);
    expect(list.json.offers.find((o) => o.customerName === 'Neha')).toMatchObject({ phone: '97******01', canMessage: true, nextAction: 'Send offer', offerSummary: '15% off (max ₹500)' });

    expect((await call('desk', 'GET', `/occasions/offers?branch=${f.bandra._id}`)).status).toBe(403);
    expect((await call('desk', 'GET', '/occasions/offers?tab=all&search=neh')).json.offers.map((o) => o.customerName)).toEqual(['Neha']);
    expect((await call('desk', 'GET', '/occasions/offers?tab=all&search=0301')).json.offers.map((o) => o.customerName)).toEqual(['Neha']);
    expect((await call('desk', 'GET', '/occasions/offers?tab=all&canMessage=no')).json.offers.some((o) => o.customerName === 'Neha')).toBe(false);
    expect((await call('desk', 'GET', '/occasions/offers?tab=used')).json.offers.map((o) => o.customerName)).toEqual(['Used']);

    const summary = await call('desk', 'GET', '/occasions/offers/summary');
    expect(summary.json).toMatchObject({ month: thisMonth, used: 1 });
    expect(summary.json.eligible).toBe(list.json.offers.length);
  });

  it('pages through the list with a cursor', async () => {
    const first = await call('desk', 'GET', '/occasions/offers?tab=all&limit=1');
    expect(first.json.offers).toHaveLength(1);
    const second = await call('desk', 'GET', `/occasions/offers?tab=all&limit=1&cursor=${first.json.nextCursor}`);
    expect(second.json.offers[0].customerName > first.json.offers[0].customerName).toBe(true);
  });

  it('owners see all their branches when they ask; the drawer has the timeline', async () => {
    const all = await call('business', 'GET', '/occasions/offers?tab=all&branch=all');
    expect(new Set(all.json.offers.map((o) => o.homeBranchName))).toEqual(new Set(['Andheri', 'Bandra']));
    const neha = all.json.offers.find((o) => o.customerName === 'Neha' && o.status === 'ISSUED');
    const drawer = await call('business', 'GET', `/occasions/offers/${neha._id}`);
    expect(drawer.json.offer).toMatchObject({ campaignName: 'Birthday Month', branchName: 'Andheri' });
    expect(drawer.json.events.map((e) => e.kind)).toEqual(['ISSUED']);
    expect(drawer.json.permission.find((p) => p.channel === 'WHATSAPP').status).toBe('OPTED_IN');
    const card = await call('desk', 'GET', `/occasions/customers/${neha.customerId}/offers`);
    expect(card.json.offers.map((o) => o.status).sort()).toEqual(['ISSUED', 'SUPERSEDED']);
  });

  it('another salon sees nothing', async () => {
    const any = await OfferIssue.findOne({ orgId: g }).lean();
    expect((await call('desert', 'GET', `/occasions/offers/${any._id}`)).status).toBe(404);
    const theirs = await call('desert', 'GET', '/occasions/offers?tab=all');
    expect(theirs.json.offers.every((o) => o.customerName !== 'Neha')).toBe(true);
  });
});

describe('turning off and withdrawing', () => {
  it('AT-29: a turned-off campaign gives no new offers; offers already given stay', async () => {
    const given = await OfferIssue.countDocuments({ campaignId: salonBirthday._id, status: 'ISSUED' });
    await call('business', 'POST', `/occasions/campaigns/${salonBirthday._id}/disable`);
    const late = await call('desk', 'POST', '/customers', { body: { name: 'Late Comer', phone: '9700000401', birthday: { month: thisMonth } } });
    expect(await OfferIssue.countDocuments({ customerId: late.json.customer._id })).toBe(0);
    expect(await OfferIssue.countDocuments({ campaignId: salonBirthday._id, status: 'ISSUED' })).toBe(given);
    // Bandra customers still get the Bandra campaign
    const bandraNew = await call('bandraDesk', 'POST', '/customers', { body: { name: 'Bandra New', phone: '9700000402', birthday: { month: thisMonth } } });
    expect(await OfferIssue.countDocuments({ customerId: bandraNew.json.customer._id, campaignId: bandraBirthday._id })).toBe(1);
  });

  it('AT-30: emergency withdraw takes back unused offers only, with a task for contacted customers and a bell', async () => {
    const offers = await OfferIssue.find({ campaignId: salonBirthday._id, year: now.year, status: 'ISSUED' }).lean();
    const [contacted, ...rest] = offers;
    await OfferIssue.updateOne({ _id: contacted._id }, { $set: { 'task.contactedAt': new Date(), 'task.state': 'CONTACTED' } });
    const usedBefore = await OfferIssue.countDocuments({ campaignId: salonBirthday._id, status: 'REDEEMED' });

    expect((await call('desk', 'POST', `/occasions/campaigns/${salonBirthday._id}/revoke`, { body: { year: now.year, reason: 'Wrong price' } })).status).toBe(403);
    expect((await call('business', 'POST', `/occasions/campaigns/${salonBirthday._id}/revoke`, { body: { year: now.year } })).status).toBe(400);
    const res = await call('business', 'POST', `/occasions/campaigns/${salonBirthday._id}/revoke`, { body: { year: now.year, reason: 'Wrong price printed' } });
    expect(res.json).toEqual({ revoked: offers.length, toTell: 1 });

    const told = await OfferIssue.findById(contacted._id).lean();
    expect(told).toMatchObject({ status: 'REVOKED', revokedReason: 'Wrong price printed' });
    expect(told.task).toMatchObject({ state: 'OPEN', kind: 'WITHDRAWN_NOTICE' });
    if (rest.length) expect((await OfferIssue.findById(rest[0]._id).lean()).task).toMatchObject({ state: 'CLOSED', closedReason: 'WITHDRAWN' });
    expect(await OfferIssue.countDocuments({ campaignId: salonBirthday._id, status: 'REDEEMED' })).toBe(usedBefore);
    const bilal = await User.findOne({ email: 'bilal@g.com' });
    expect(await Notification.exists({ userId: bilal._id, message: /withdrew/ })).toBeTruthy();

    const action = await call('business', 'GET', '/occasions/offers?tab=action&branch=all');
    expect(action.json.offers.find((o) => o._id === String(contacted._id)).nextAction).toBe('Tell the customer the offer was withdrawn');
  });

  it('the settings page shows the last run; the front desk can’t run it', async () => {
    expect((await call('desk', 'POST', '/occasions/settings/run-now')).status).toBe(403);
    const settings = await call('business', 'GET', '/occasions/settings');
    expect(settings.json.lastRun).toMatchObject({ by: expect.any(String) });
  });

  it('switching the feature off hides the list and stops new offers', async () => {
    await Organization.updateOne({ _id: g }, { $set: { 'occasionOffers.enabled': false } });
    expect((await call('desk', 'GET', '/occasions/offers')).json.error.code).toBe('FEATURE_OFF');
    const off = await call('bandraDesk', 'POST', '/customers', { body: { name: 'Off Time', phone: '9700000403', birthday: { month: thisMonth } } });
    expect(await OfferIssue.countDocuments({ customerId: off.json.customer._id })).toBe(0);
    await runScheduledTick();
    expect(await OccasionCampaign.countDocuments({ orgId: g })).toBeGreaterThan(0);
    expect(await OfferIssue.countDocuments({ customerId: off.json.customer._id })).toBe(0);
  });
});
