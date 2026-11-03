// Email Part 3: automatic offer emails for campaigns set to "Send automatically by email" — only inside the send
// hours (branch time), within the salon's daily limit, the same send check and 7-day slot as staff, never twice.
// The mailer is held: emails are queued by the engine and sent when a test calls processOutbox().
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { ActivityLog, Customer, EmailOutbox, OfferEvent, OfferIssue, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { configureMail } from '../src/modules/mail/config.js';
import { holdMailer, processOutbox, resetMailer } from '../src/modules/mail/outbox.js';
import { reevaluateCustomer } from '../src/modules/occasions/engine/reevaluate.js';
import { autoEmailCampaignIds, autoSendForBranch, insideSendHours } from '../src/modules/occasions/engine/autoSend.js';
import { runForOrg } from '../src/modules/occasions/engine/scheduler.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
let server;
let api;
let f;
let g;
let campaign;
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

// Today at a given time in Mumbai (the offers are this month's)
const today = DateTime.now().setZone('Asia/Kolkata');
const at = (time) => DateTime.fromISO(`${today.toISODate()}T${time}`, { zone: 'Asia/Kolkata' }).toJSDate();
const settingsRow = { autoEmail: { dailyLimit: 30, sendFrom: '10:00', sendUntil: '19:00' }, channelOrder: ['WHATSAPP', 'SMS', 'EMAIL'] };
const runBranch = async (now = at('12:00'), settings = settingsRow) => autoSendForBranch(g, f.andheri, { now, settings, campaignIds: await autoEmailCampaignIds(g) });

let n = 0;
async function customerWithOffer(name, { marketing = { EMAIL: { status: 'OPTED_IN' } }, email = `auto${++n}@mail.com` } = {}) {
  const customer = await Customer.create({
    orgId: g,
    name,
    phone: `96000008${String(++n).padStart(2, '0')}`,
    email,
    homeBranchId: f.andheri._id,
    occasions: { birthday: { month: today.month, source: 'STAFF' } },
    marketing,
  });
  await reevaluateCustomer(g, customer._id);
  return { customer, offer: await OfferIssue.findOne({ customerId: customer._id }).lean() };
}
const offerById = (id) => OfferIssue.findById(id).lean();

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
  ]);
  await migrateOccasions({ log: () => {} });
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  cookies.business = await login('anita@g.com');
  cookies.desk = await login('kavya@g.com');

  const settings = await call('business', 'GET', '/occasions/settings');
  await call('business', 'PUT', '/occasions/settings', { body: { enabled: true }, headers: { 'if-match': String(settings.json.version) } });
  const created = await call('business', 'POST', '/occasions/campaigns', {
    body: { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds: [String(f.haircut._id)] } },
  });
  campaign = (await call('business', 'POST', `/occasions/campaigns/${created.json.campaign._id}/publish`)).json.campaign;
  holdMailer();
});

afterAll(async () => {
  holdMailer(false);
  configureMail();
  server?.close();
  await stopDb();
});

beforeEach(async () => {
  configureMail(); // development "log" mode
  resetMailer();
  await Promise.all([Customer.deleteMany({ orgId: g }), OfferIssue.deleteMany({ orgId: g }), EmailOutbox.deleteMany({})]);
});

async function setMode(mode) {
  const current = await call('business', 'GET', `/occasions/campaigns/${campaign._id}`);
  return call('business', 'PATCH', `/occasions/campaigns/${campaign._id}`, { body: { deliveryMode: mode }, headers: { 'if-match': String(current.json.campaign?.version ?? current.json.version) } });
}

describe('choosing automatic emails', () => {
  it('the owner switches a live campaign to send automatically; it applies straight away and is logged', async () => {
    const res = await setMode('AUTO_EMAIL');
    expect(res.status).toBe(200);
    const view = res.json.campaign ?? res.json;
    expect(view).toMatchObject({ deliveryMode: 'AUTO_EMAIL', deliveryWarning: null, status: 'PUBLISHED' });
    expect(await ActivityLog.exists({ action: 'occasions.campaign_edited', summary: /offer emails are sent automatically/ })).toBeTruthy();
    expect((await autoEmailCampaignIds(g)).map(String)).toEqual([String(campaign._id)]);
  });

  it('the front desk can’t change it', async () => {
    const current = await call('business', 'GET', `/occasions/campaigns/${campaign._id}`);
    const res = await call('desk', 'PATCH', `/occasions/campaigns/${campaign._id}`, { body: { deliveryMode: 'STAFF_ASSISTED' }, headers: { 'if-match': String((current.json.campaign ?? current.json).version) } });
    expect(res.status).toBe(403);
  });

  it('send hours and the daily limit are saved in the settings, and bad times are refused', async () => {
    const settings = await call('business', 'GET', '/occasions/settings');
    expect(settings.json.autoEmail).toEqual({ dailyLimit: 30, sendFrom: '10:00', sendUntil: '19:00' });
    const bad = await call('business', 'PUT', '/occasions/settings', { body: { autoEmail: { dailyLimit: 30, sendFrom: '19:00', sendUntil: '10:00' } }, headers: { 'if-match': String(settings.json.version) } });
    expect(bad.status).toBe(400);
    const good = await call('business', 'PUT', '/occasions/settings', { body: { autoEmail: { dailyLimit: 20, sendFrom: '09:30', sendUntil: '20:00' } }, headers: { 'if-match': String(settings.json.version) } });
    expect(good.status).toBe(200);
    expect((await call('business', 'GET', '/occasions/settings')).json.autoEmail).toEqual({ dailyLimit: 20, sendFrom: '09:30', sendUntil: '20:00' });
  });
});

describe('sending automatically', () => {
  it('sends only inside the send hours, in the branch’s time zone', async () => {
    expect(insideSendHours(at('09:59'), 'Asia/Kolkata', settingsRow.autoEmail)).toBe(false);
    expect(insideSendHours(at('10:00'), 'Asia/Kolkata', settingsRow.autoEmail)).toBe(true);
    expect(insideSendHours(at('19:00'), 'Asia/Kolkata', settingsRow.autoEmail)).toBe(false);
    // 12:00 in Mumbai is 10:30 in Dubai, 08:30 in Dubai is 10:00 in Mumbai
    expect(insideSendHours(at('12:00'), 'Asia/Dubai', settingsRow.autoEmail)).toBe(true);
    expect(insideSendHours(at('10:00'), 'Asia/Dubai', settingsRow.autoEmail)).toBe(false);

    const { offer } = await customerWithOffer('Early Bird');
    expect((await runBranch(at('08:00'))).queued).toBe(0);
    expect(await EmailOutbox.countDocuments()).toBe(0);
    expect((await runBranch(at('12:00'))).queued).toBe(1);
    const row = await EmailOutbox.findOne({ 'ref.offerId': offer._id }).lean();
    expect(row).toMatchObject({ kind: 'OCCASION_OFFER', priority: 5, dedupeKey: `offer:${offer._id}:auto`, createdBy: { name: 'Automatic' } });
  });

  it('emails customers who allow email; WhatsApp-only and opted-out customers stay on the staff list', async () => {
    const { customer: maya, offer: mayaOffer } = await customerWithOffer('Maya');
    const { offer: whatsOnly } = await customerWithOffer('Whats Only', { marketing: { WHATSAPP: { status: 'OPTED_IN' } } });
    const { offer: optedOut } = await customerWithOffer('Opted Out', { marketing: { EMAIL: { status: 'OPTED_OUT' }, SMS: { status: 'OPTED_IN' } } });
    const { offer: noEmail } = await customerWithOffer('No Email', { email: null, marketing: { EMAIL: { status: 'OPTED_IN' }, SMS: { status: 'OPTED_IN' } } });

    expect((await runBranch()).queued).toBe(1);
    const sent = await offerById(mayaOffer._id);
    expect(sent.task).toMatchObject({ state: 'CONTACTED', sentVia: 'EMAIL', sentAutomatically: true, emailStatus: 'QUEUED' });
    expect((await Customer.findById(maya._id).lean()).marketing.lastPromoAt).toBeTruthy();
    for (const offer of [whatsOnly, optedOut, noEmail]) expect((await offerById(offer._id)).task).toMatchObject({ state: 'OPEN', sentAt: null, emailStatus: null });

    await processOutbox();
    expect((await offerById(mayaOffer._id)).task.emailStatus).toBe('SENT');
    expect(await OfferEvent.exists({ offerId: mayaOffer._id, kind: 'SENT', actorName: 'Automatic', note: 'Emailed automatically' })).toBeTruthy();
  });

  it('the salon’s daily limit holds; the rest go the next day', async () => {
    const offers = [];
    for (const name of ['One', 'Two', 'Three']) offers.push((await customerWithOffer(name)).offer);
    const limited = { ...settingsRow, autoEmail: { ...settingsRow.autoEmail, dailyLimit: 2 } };
    expect((await runBranch(at('12:00'), limited)).queued).toBe(2);
    expect((await runBranch(at('12:10'), limited)).queued).toBe(0);
    expect(await EmailOutbox.countDocuments()).toBe(2);

    // A day later the third one goes
    await EmailOutbox.collection.updateMany({}, { $set: { createdAt: new Date(at('12:20').getTime() - 25 * 60 * 60 * 1000) } });
    expect((await runBranch(at('12:20'), limited)).queued).toBe(1);
    const emailed = await OfferIssue.countDocuments({ _id: { $in: offers.map((o) => o._id) }, 'task.sentAutomatically': true });
    expect(emailed).toBe(3);
  });

  it('the platform limit holds too (shared Gmail account)', async () => {
    configureMail({ dailyLimit: 1 });
    await customerWithOffer('First');
    await customerWithOffer('Second');
    expect((await runBranch()).queued).toBe(1);
  });

  it('two servers running at once never email the same offer twice', async () => {
    for (const name of ['A', 'B', 'C', 'D']) await customerWithOffer(name);
    const [x, y] = await Promise.all([runBranch(), runBranch()]);
    expect(x.queued + y.queued).toBe(4);
    const perOffer = await EmailOutbox.aggregate([{ $group: { _id: '$ref.offerId', n: { $sum: 1 } } }]);
    expect(perOffer).toHaveLength(4);
    expect(perOffer.every((p) => p.n === 1)).toBe(true);
  });

  it('a customer messaged by staff in the last 7 days is not emailed', async () => {
    const { customer, offer } = await customerWithOffer('Recently Called');
    await Customer.updateOne({ _id: customer._id }, { $set: { 'marketing.lastPromoAt': new Date(Date.now() - 2 * 24 * 60 * 60 * 1000) } });
    expect((await runBranch()).queued).toBe(0);
    expect((await offerById(offer._id)).task.state).toBe('OPEN');
  });

  it('an offer staff already sent is left alone', async () => {
    const { offer } = await customerWithOffer('Staff Sent', { marketing: { EMAIL: { status: 'OPTED_IN' }, WHATSAPP: { status: 'OPTED_IN' } } });
    expect((await call('desk', 'POST', `/occasions/offers/${offer._id}/send`, { body: { channel: 'WHATSAPP' } })).status).toBe(200);
    expect((await runBranch()).queued).toBe(0);
  });

  it('a failed automatic email goes back to the staff list and is not tried automatically again', async () => {
    const { customer, offer } = await customerWithOffer('Bounced');
    await runBranch();
    await Customer.updateOne({ _id: customer._id }, { $set: { email: 'changed@mail.com' } }); // the check before sending refuses it
    await processOutbox();
    const back = await offerById(offer._id);
    expect(back.task).toMatchObject({ state: 'OPEN', emailStatus: 'FAILED', sentAutomatically: false, sentAt: null });
    expect((await runBranch(at('12:30'))).queued).toBe(0);
    expect(await EmailOutbox.countDocuments({ 'ref.offerId': offer._id })).toBe(1);
  });

  it('with email not set up, nothing is queued and the campaign shows a warning', async () => {
    configureMail({ mode: 'off' });
    await customerWithOffer('Nobody Emails');
    expect(await autoEmailCampaignIds(g)).toEqual([]);
    expect((await runBranch()).queued).toBe(0);
    const view = await call('business', 'GET', `/occasions/campaigns/${campaign._id}`);
    expect((view.json.campaign ?? view.json).deliveryWarning).toMatch(/Email isn’t set up/);
  });

  it('the offer engine’s run sends them, and the report shows who was emailed automatically', async () => {
    await customerWithOffer('Via Engine');
    const result = await runForOrg(g, { now: at('12:00') });
    expect(result.emailed).toBe(1);
    const res = await fetch(`${api}/occasions/reports?format=csv`, { headers: { cookie: cookies.business } });
    const lines = (await res.text()).replace(/^\uFEFF/, '').split(/\r?\n/);
    const header = lines[0].split(',');
    const row = lines.find((l) => l.startsWith('Via Engine')).split(',');
    expect(row[header.indexOf('Emailed automatically')]).toBe('Yes');
  });

  it('switching back to staff sends stops automatic emails at once', async () => {
    expect((await setMode('STAFF_ASSISTED')).status).toBe(200);
    await customerWithOffer('Manual Again');
    expect((await runBranch()).queued).toBe(0);
    await setMode('AUTO_EMAIL');
  });
});
