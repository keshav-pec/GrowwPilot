// Birthday & Anniversary Offers, Phase 4: staff follow-up — permission-checked send, 7-day limit, call outcomes,
// assignment, message wording. PRD AT-09, AT-10, AT-11, AT-12, AT-16. (AT-13/14/15 need automatic sending: not in this build.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { ActivityLog, Customer, OfferEvent, OfferIssue, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { checkMessages, defaultMessages, fillMessage, messageValues } from '../src/modules/occasions/outreach/templates.js';
import { checkSend } from '../src/modules/occasions/outreach/gate.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
let server;
let api;
let f;
let g;
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

const now = DateTime.now().setZone('Asia/Kolkata');
const thisMonth = now.month;
let birthdayCampaign;
const optedIn = (...channels) => Object.fromEntries(channels.map((c) => [c, { status: 'OPTED_IN' }]));
const addCustomer = (name, phone, { branch = f.andheri, birthday = true, anniversary = false, marketing = {}, email } = {}) =>
  Customer.create({
    orgId: g,
    name,
    phone,
    email,
    homeBranchId: branch._id,
    occasions: { birthday: birthday ? { month: thisMonth, source: 'STAFF' } : null, anniversary: anniversary ? { month: thisMonth, source: 'STAFF' } : null },
    marketing,
  });
const offerOf = (customer, type = 'BIRTHDAY') => OfferIssue.findOne({ customerId: customer._id, type }).lean();
const preview = (who, offer, channel) => call(who, 'GET', `/occasions/offers/${offer._id}/send-preview${channel ? `?channel=${channel}` : ''}`);
const send = (who, offer, channel, key) => call(who, 'POST', `/occasions/offers/${offer._id}/send`, { body: { channel }, key });
const contact = (who, offer, body) => call(who, 'POST', `/occasions/offers/${offer._id}/contact`, { body });

let maya; // WhatsApp opted in
let quiet; // no permission
let smsOnly; // WhatsApp opted out, SMS opted in
let both; // birthday and anniversary this month
let rahul; // Bandra

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Dev', email: 'dev@g.com', passwordHash, branchIds: [f.bandra._id] },
  ]);
  await migrateOccasions({ log: () => {} });
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', desk: 'kavya@g.com', bandraDesk: 'dev@g.com' })) cookies[who] = await login(email);

  maya = await addCustomer('Maya Rao', '9700000501', { marketing: optedIn('WHATSAPP') });
  quiet = await addCustomer('Quiet', '9700000502');
  smsOnly = await addCustomer('Sunil', '9700000503', { marketing: { WHATSAPP: { status: 'OPTED_OUT' }, SMS: { status: 'OPTED_IN' } } });
  both = await addCustomer('Both', '9700000504', { anniversary: true, marketing: optedIn('WHATSAPP') });
  rahul = await addCustomer('Rahul', '9700000505', { branch: f.bandra, marketing: optedIn('WHATSAPP') });
  await migrateOccasions({ log: () => {} });

  const settings = await call('business', 'GET', '/occasions/settings');
  await call('business', 'PUT', '/occasions/settings', { body: { enabled: true }, headers: { 'if-match': String(settings.json.version) } });
  const serviceIds = [String(f.haircut._id), String(f.beardTrim._id)];
  for (const body of [
    { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds } },
    { type: 'ANNIVERSARY', scope: 'BUSINESS_DEFAULT', name: 'Anniversary Month', rules: { discountType: 'FLAT', value: 30000, minSubtotal: 150000, serviceIds } },
  ]) {
    const created = await call('business', 'POST', '/occasions/campaigns', { body });
    const published = await call('business', 'POST', `/occasions/campaigns/${created.json.campaign._id}/publish`);
    if (body.type === 'BIRTHDAY') birthdayCampaign = published.json.campaign;
  }
});

afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('message wording', () => {
  it('the defaults keep every required part, and missing parts are refused', () => {
    for (const type of ['BIRTHDAY', 'ANNIVERSARY']) expect(checkMessages(defaultMessages(type))).toEqual([]);
    const broken = { ...defaultMessages('BIRTHDAY'), SMS: { body: 'Hi {first_name}, offer from {salon_name}: {offer_summary}' } };
    expect(checkMessages(broken).map((p) => p.message)).toEqual(['The SMS message must keep {expiry_date}', 'The SMS message must keep the opt-out line']);
  });

  it('fills in short, safe values (first name only, no line breaks)', () => {
    const values = messageValues({ customerName: 'Maya {evil}\nRao', salonName: 'Glamour', salonPhone: '9800000000', rules: { discountType: 'FLAT', value: 30000, minSubtotal: 0 }, validUntil: new Date('2030-11-30T18:29:59.999Z'), zone: 'Asia/Kolkata' });
    expect(values['{first_name}']).toBe('Maya');
    expect(fillMessage('{first_name}: {offer_summary} till {expiry_date}', values)).toBe('Maya: ₹300 off till 30 Nov 2030');
  });
});

describe('the send check', () => {
  const offer = { status: 'ISSUED', validUntil: new Date('2099-01-01') };
  const order = ['WHATSAPP', 'SMS', 'EMAIL'];
  it('AT-11: uses the first channel the customer allowed, in the salon’s order', () => {
    const result = checkSend({ offer, customer: { phone: '9876543210', marketing: { WHATSAPP: { status: 'OPTED_OUT' }, SMS: { status: 'OPTED_IN' } } }, channelOrder: order });
    expect(result).toMatchObject({ allowed: true, channel: 'SMS', channels: ['SMS'] });
  });
  it('refuses with no permission, within 7 days, or before the birthday message', () => {
    expect(checkSend({ offer, customer: { phone: '9876543210', marketing: {} }, channelOrder: order }).code).toBe('NO_PERMISSION');
    const last = new Date('2030-11-01T10:00:00Z');
    const recent = checkSend({ offer, customer: { phone: '9876543210', marketing: { WHATSAPP: { status: 'OPTED_IN' }, lastPromoAt: last } }, channelOrder: order, now: new Date('2030-11-05T10:00:00Z') });
    expect(recent).toMatchObject({ code: 'RECENTLY_CONTACTED', nextAllowedAt: new Date('2030-11-08T10:00:00Z') });
    expect(checkSend({ offer, customer: { phone: '9876543210', marketing: { WHATSAPP: { status: 'OPTED_IN' }, lastPromoAt: last } }, channelOrder: order, now: new Date('2030-11-08T10:00:00Z') }).allowed).toBe(true);
    expect(checkSend({ offer, customer: { phone: '9876543210', marketing: { WHATSAPP: { status: 'OPTED_IN' } } }, channelOrder: order, birthdayFirst: true }).code).toBe('BIRTHDAY_FIRST');
    expect(checkSend({ offer, customer: { email: 'x@y.com', phone: '9876543210', marketing: { EMAIL: { status: 'OPTED_IN' } } }, channelOrder: order }).channel).toBe('EMAIL');
    expect(checkSend({ offer, customer: { phone: '9876543210', marketing: { EMAIL: { status: 'OPTED_IN' } } }, channelOrder: order }).code).toBe('NO_DESTINATION');
  });
});

describe('sending the offer', () => {
  it('previews and sends on WhatsApp, marks the task contacted, and starts the 7-day limit', async () => {
    const offer = await offerOf(maya);
    const look = await preview('desk', offer);
    expect(look.json).toMatchObject({ allowed: true, channel: 'WHATSAPP', channels: ['WHATSAPP'], to: '97******01' });
    expect(look.json.body).toContain('Hi Maya!');
    expect(look.json.body).toContain('15% off (max ₹500)');
    expect(look.json.body).toContain('Reply STOP to opt out');

    const sent = await send('desk', offer, 'WHATSAPP');
    expect(sent.status).toBe(200);
    expect(sent.json.link).toMatch(/^https:\/\/wa\.me\/919700000501\?text=Hi%20Maya/);
    const after = await OfferIssue.findById(offer._id).lean();
    expect(after.task).toMatchObject({ state: 'CONTACTED', outcome: 'SENT_WHATSAPP' });
    expect(after.task.contactedAt).toBeInstanceOf(Date);
    expect((await Customer.findById(maya._id).lean()).marketing.lastPromoAt).toBeInstanceOf(Date);
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'SENT' })).toBe(1);

    const list = await call('desk', 'GET', '/occasions/offers?tab=contacted');
    expect(list.json.offers.find((o) => o.customerName === 'Maya Rao').nextAction).toBe('Book');

    // Sending again within 7 days is refused, with the date it becomes possible
    const again = await preview('desk', offer);
    expect(again.json).toMatchObject({ allowed: false, code: 'RECENTLY_CONTACTED' });
    expect(new Date(again.json.nextAllowedAt).getTime()).toBeGreaterThan(Date.now() + 6.9 * 24 * 3600 * 1000);
  });

  it('AT-10: no permission: no send, the offer stays usable', async () => {
    const offer = await offerOf(quiet);
    expect((await preview('desk', offer)).json).toMatchObject({ allowed: false, code: 'NO_PERMISSION' });
    expect((await send('desk', offer, 'WHATSAPP')).json.error.code).toBe('NO_PERMISSION');
    expect((await OfferIssue.findById(offer._id).lean()).status).toBe('ISSUED');
    expect((await Customer.findById(quiet._id).lean()).marketing.lastPromoAt ?? null).toBeNull();
  });

  it('AT-11: WhatsApp opted out and SMS opted in sends by SMS', async () => {
    const offer = await offerOf(smsOnly);
    expect((await preview('desk', offer)).json.channel).toBe('SMS');
    expect((await send('desk', offer, 'WHATSAPP')).json.error.code).toBe('CHANNEL_NOT_ALLOWED');
    const sent = await send('desk', offer, 'SMS');
    expect(sent.json.link).toMatch(/^sms:\+919700000503\?body=/);
  });

  it('AT-09: with both occasions this month the birthday goes first, then the anniversary waits 7 days', async () => {
    const birthday = await offerOf(both, 'BIRTHDAY');
    const anniversary = await offerOf(both, 'ANNIVERSARY');
    expect((await preview('desk', anniversary)).json.code).toBe('BIRTHDAY_FIRST');
    expect((await send('desk', birthday, 'WHATSAPP')).status).toBe(200);
    expect((await preview('desk', anniversary)).json.code).toBe('RECENTLY_CONTACTED');
    expect((await send('desk', anniversary, 'WHATSAPP')).status).toBe(409);
  });

  it('AT-12: permission withdrawn between preview and confirm is refused and logged', async () => {
    const late = await addCustomer('Late Withdraw', '9700000506', { marketing: optedIn('WHATSAPP') });
    await call('business', 'POST', '/occasions/settings/run-now');
    const offer = await offerOf(late);
    expect((await preview('desk', offer)).json.allowed).toBe(true);
    await call('desk', 'POST', `/occasions/customers/${late._id}/consents`, { body: { channel: 'WHATSAPP', status: 'OPTED_OUT', source: 'CUSTOMER_REQUEST' } });
    const res = await send('desk', offer, 'WHATSAPP');
    expect(res.status).toBe(409);
    expect(await ActivityLog.exists({ action: 'occasions.send_refused', summary: /Late Withdraw/ })).toBeTruthy();
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'SENT' })).toBe(0);
  });

  it('two desks pressing Send at the same moment count as one message', async () => {
    const twin = await addCustomer('Twin', '9700000507', { marketing: optedIn('WHATSAPP') });
    await call('business', 'POST', '/occasions/settings/run-now');
    const offer = await offerOf(twin);
    const results = await Promise.all([send('desk', offer, 'WHATSAPP'), send('business', offer, 'WHATSAPP')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'SENT' })).toBe(1);
  });

  it('the same click sent twice (same key) gives the same answer and counts once', async () => {
    const repeat = await addCustomer('Repeat', '9700000508', { marketing: optedIn('WHATSAPP') });
    await call('business', 'POST', '/occasions/settings/run-now');
    const offer = await offerOf(repeat);
    const key = newKey();
    const [a, b] = [await send('desk', offer, 'WHATSAPP', key), await send('desk', offer, 'WHATSAPP', key)];
    expect(a.json.link).toBe(b.json.link);
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'SENT' })).toBe(1);
  });
});

describe('calls', () => {
  it('AT-16: no answer twice closes the task as unreachable, with the full history', async () => {
    const offer = await offerOf(quiet);
    const first = await contact('desk', offer, { outcome: 'NO_ANSWER' });
    expect(first.status).toBe(200);
    let task = (await OfferIssue.findById(offer._id).lean()).task;
    const followUp = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 }).toJSDate();
    expect(task).toMatchObject({ state: 'OPEN', attempts: 1 });
    expect(task.dueAt).toEqual(followUp);

    await contact('desk', offer, { outcome: 'NO_ANSWER', note: 'Tried twice' });
    task = (await OfferIssue.findById(offer._id).lean()).task;
    expect(task).toMatchObject({ state: 'CLOSED', closedReason: 'UNREACHABLE', attempts: 2 });
    const events = await OfferEvent.find({ offerId: offer._id, kind: 'CONTACT' }).sort({ createdAt: 1 }).lean();
    expect(events.map((e) => e.note)).toEqual([expect.stringMatching(/^No answer: follow up/), 'No answer (2 times): closed as unreachable. Tried twice']);
    // A call never counts as a message
    expect((await Customer.findById(quiet._id).lean()).marketing.lastPromoAt ?? null).toBeNull();
  });

  it('call later must be in the future and before the offer ends; wrong details asks to fix the number', async () => {
    const offer = await offerOf(rahul);
    expect((await contact('bandraDesk', offer, { outcome: 'CALL_LATER' })).json.error.code).toBe('CALLBACK_REQUIRED');
    expect((await contact('bandraDesk', offer, { outcome: 'CALL_LATER', callbackAt: new Date(Date.now() - 60000).toISOString() })).json.error.code).toBe('CALLBACK_IN_PAST');
    const tooLate = new Date(offer.validUntil.getTime() + 3600000).toISOString();
    expect((await contact('bandraDesk', offer, { outcome: 'CALL_LATER', callbackAt: tooLate })).json.error.code).toBe('CALLBACK_AFTER_EXPIRY');
    const at = new Date(Math.min(Date.now() + 3600000, offer.validUntil.getTime() - 1000));
    expect((await contact('bandraDesk', offer, { outcome: 'CALL_LATER', callbackAt: at.toISOString() })).status).toBe(200);
    expect((await OfferIssue.findById(offer._id).lean()).task.dueAt).toEqual(at);

    const wrong = await contact('bandraDesk', offer, { outcome: 'WRONG_DETAILS' });
    expect(wrong.json.fixDetails).toBe(true);
    expect((await OfferIssue.findById(offer._id).lean()).task).toMatchObject({ state: 'CLOSED', closedReason: 'WRONG_DETAILS' });
  });

  it('the front desk can’t act on another branch’s offer', async () => {
    const offer = await offerOf(rahul);
    expect((await contact('desk', offer, { outcome: 'REACHED' })).status).toBe(404);
    expect((await preview('desk', offer)).status).toBe(404);
    expect((await send('desk', offer, 'WHATSAPP')).status).toBe(404);
  });
});

describe('assigning', () => {
  it('assigns to someone at the customer’s branch; the history is kept', async () => {
    const offer = await offerOf(smsOnly);
    const people = await call('desk', 'GET', `/occasions/offers/${offer._id}/assignees`);
    expect(people.json.assignees.map((u) => u.name)).toEqual(['Anita', 'Kavya']);
    const dev = await User.findOne({ email: 'dev@g.com' });
    expect((await call('desk', 'POST', `/occasions/offers/${offer._id}/assign`, { body: { assigneeId: String(dev._id) } })).json.error.code).toBe('INVALID_ASSIGNEE');
    const kavya = await User.findOne({ email: 'kavya@g.com' });
    expect((await call('desk', 'POST', `/occasions/offers/${offer._id}/assign`, { body: { assigneeId: String(kavya._id) } })).status).toBe(200);
    expect((await call('desk', 'GET', '/occasions/offers?tab=all&assignee=me')).json.offers.map((o) => o.customerName)).toEqual(['Sunil']);
    await call('desk', 'POST', `/occasions/offers/${offer._id}/assign`, { body: { assigneeId: null } });
    expect((await OfferEvent.find({ offerId: offer._id, kind: 'ASSIGNED' }).lean()).map((e) => e.note)).toEqual(['Assigned to Kavya', 'Assigned to anyone at the branch']);
  });
});

describe('opting out and wording', () => {
  it('opting out of every channel closes the open task; the offer still works in the salon', async () => {
    const leaving = await addCustomer('Leaving', '9700000509', { marketing: optedIn('WHATSAPP') });
    await call('business', 'POST', '/occasions/settings/run-now');
    for (const channel of ['WHATSAPP', 'SMS', 'EMAIL']) {
      await call('desk', 'POST', `/occasions/customers/${leaving._id}/consents`, { body: { channel, status: 'OPTED_OUT', source: 'CUSTOMER_REQUEST' } });
    }
    const offer = await offerOf(leaving);
    expect(offer.status).toBe('ISSUED');
    expect(offer.task).toMatchObject({ state: 'CLOSED', closedReason: 'OPTED_OUT' });
  });

  it('owners can change the wording, which must keep the required parts; the front desk can’t', async () => {
    const campaign = (await call('business', 'GET', `/occasions/campaigns/${birthdayCampaign._id}`)).json.campaign;
    const messages = { ...campaign.messages, WHATSAPP: { body: 'Hello {first_name}! {salon_name} wishes you well: {offer_summary} until {expiry_date}. Reply or call to book. Reply STOP to opt out.' } };
    const headers = { 'if-match': String(campaign.version) };
    expect((await call('desk', 'PUT', `/occasions/campaigns/${campaign._id}/messages`, { body: messages, headers })).status).toBe(403);
    const bad = { ...messages, WHATSAPP: { body: 'Hello {first_name}, {salon_name} offers {offer_summary}. Reply STOP to opt out.' } };
    expect((await call('business', 'PUT', `/occasions/campaigns/${campaign._id}/messages`, { body: bad, headers })).json.error.code).toBe('INVALID_MESSAGES');
    const saved = await call('business', 'PUT', `/occasions/campaigns/${campaign._id}/messages`, { body: messages, headers });
    expect(saved.json.campaign.messagesChanged).toBe(true);

    const fresh = await addCustomer('Fresh Start', '9700000510', { marketing: optedIn('WHATSAPP') });
    await call('business', 'POST', '/occasions/settings/run-now');
    expect((await preview('desk', await offerOf(fresh))).json.body).toMatch(/^Hello Fresh! Glamour wishes you well/);
  });
});
