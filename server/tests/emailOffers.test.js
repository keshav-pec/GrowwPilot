// Email Part 2: the app sends the occasion offer email — queued in the send transaction, permission checked again
// before sending, the 7-day slot given back on failure, and the unsubscribe link. The mailer is held, so each test
// decides when emails go out (processOutbox).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { ActivityLog, ConsentEvent, Customer, EmailOutbox, Notification, OfferEvent, OfferIssue, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { configureMail } from '../src/modules/mail/config.js';
import { holdMailer, processOutbox, resetMailer } from '../src/modules/mail/outbox.js';
import { loggedEmails } from '../src/modules/mail/transport/send.js';
import { reevaluateCustomer } from '../src/modules/occasions/engine/reevaluate.js';
import { readToken, unsubscribeToken } from '../src/modules/occasions/outreach/unsubscribe.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

// A fake Apps Script, for the tests that need a real send to fail
const SCRIPT = 'https://script.google.com/macros/s/fake-offers/exec';
const script = { reply: null, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith(SCRIPT)) return realFetch(url, options);
  const payload = JSON.parse(options.body);
  script.calls.push(payload);
  return new Response(JSON.stringify(script.reply?.(payload) ?? { status: 'success' }), { status: 200 });
};
const useScript = () => configureMail({ scriptUrl: SCRIPT, scriptSecret: 'a-secret-that-is-long-enough-123' });

const PASSWORD = 'Password@123';
let server;
let api;
let origin;
let f;
let g;
let kavya;
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
const send = (who, offer, channel, key) => call(who, 'POST', `/occasions/offers/${offer._id}/send`, { body: { channel }, key });
const preview = (who, offer, channel) => call(who, 'GET', `/occasions/offers/${offer._id}/send-preview?channel=${channel}`);
const offerById = (id) => OfferIssue.findById(id).lean();
const customerById = (id) => Customer.findById(id).lean();

const thisMonth = DateTime.now().setZone('Asia/Kolkata').month;
let n = 0;
// A customer with a birthday this month who allows offer emails (or other channels), and their offer
async function customerWithOffer(name, { email = `c${++n}@mail.com`, marketing = { EMAIL: { status: 'OPTED_IN' } }, branch = f.andheri } = {}) {
  const customer = await Customer.create({
    orgId: g,
    name,
    phone: `97000007${String(++n).padStart(2, '0')}`,
    email,
    homeBranchId: branch._id,
    occasions: { birthday: { month: thisMonth, source: 'STAFF' } },
    marketing,
  });
  await reevaluateCustomer(g, customer._id);
  const offer = await OfferIssue.findOne({ customerId: customer._id, type: 'BIRTHDAY' }).lean();
  return { customer, offer };
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  [, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Dev', email: 'dev@g.com', passwordHash, branchIds: [f.bandra._id] },
  ]);
  await migrateOccasions({ log: () => {} });
  server = app.listen(0);
  origin = `http://127.0.0.1:${server.address().port}`;
  api = `${origin}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', desk: 'kavya@g.com', bandraDesk: 'dev@g.com' })) cookies[who] = await login(email);

  const settings = await call('business', 'GET', '/occasions/settings');
  await call('business', 'PUT', '/occasions/settings', { body: { enabled: true }, headers: { 'if-match': String(settings.json.version) } });
  const created = await call('business', 'POST', '/occasions/campaigns', {
    body: { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds: [String(f.haircut._id)] } },
  });
  await call('business', 'POST', `/occasions/campaigns/${created.json.campaign._id}/publish`);
  holdMailer();
});

afterAll(async () => {
  holdMailer(false);
  configureMail();
  globalThis.fetch = realFetch;
  server?.close();
  await stopDb();
});

beforeEach(() => {
  configureMail(); // email not set up: development "log" mode (emails are kept in memory, marked Logged)
  resetMailer();
  script.reply = null;
  script.calls = [];
});

describe('sending the offer by email', () => {
  it('Send on Email queues one email (no mailto link), the task shows Queued, then Sent', async () => {
    const { customer, offer } = await customerWithOffer('Maya Rao', { email: 'maya.rao@gmail.com' });
    const look = await preview('desk', offer, 'EMAIL');
    expect(look.json).toMatchObject({ allowed: true, channel: 'EMAIL', appSends: true, to: 'ma***@gmail.com' });
    expect(look.json.body).toContain('use the unsubscribe link at the bottom of this email');

    const sent = await send('desk', offer, 'EMAIL');
    expect(sent.status).toBe(200);
    expect(sent.json).toMatchObject({ queued: true, channel: 'EMAIL', to: 'ma***@gmail.com' });
    expect(sent.json.link).toBeUndefined();

    const rows = await EmailOutbox.find({ 'ref.offerId': offer._id }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'OCCASION_OFFER', priority: 4, to: 'maya.rao@gmail.com', fromName: 'Glamour', replyTo: 'a@a.com', status: 'PENDING' });
    expect(rows[0].subject).toBe('A birthday treat from Glamour');
    expect(rows[0].text).toMatch(/Unsubscribe: https?:\/\/[^/\s]+\/api\/public\/unsubscribe\/[\w-]+\.[\w-]+$/);
    expect(rows[0].html).toContain('>Unsubscribe</a>');
    expect(rows[0].html).toContain('agreed to receive offers from Glamour by email');
    expect(rows[0].headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    let saved = await offerById(offer._id);
    expect(saved.task).toMatchObject({ state: 'CONTACTED', sentVia: 'EMAIL', emailStatus: 'QUEUED', emailOutboxId: rows[0]._id });
    expect((await customerById(customer._id)).marketing.lastPromoAt).toBeTruthy();

    await processOutbox();
    saved = await offerById(offer._id);
    expect(saved.task).toMatchObject({ state: 'CONTACTED', emailStatus: 'SENT', emailError: null });
    expect(await OfferEvent.exists({ offerId: offer._id, kind: 'EMAIL_SENT' })).toBeTruthy();
    expect(loggedEmails().at(-1).to).toBe('maya.rao@gmail.com');
  });

  it('two desks pressing Send together send one email', async () => {
    const { offer } = await customerWithOffer('Twice');
    const results = await Promise.all([send('desk', offer, 'EMAIL'), send('business', offer, 'EMAIL')]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await EmailOutbox.countDocuments({ 'ref.offerId': offer._id })).toBe(1);
  });

  it('the same request sent twice (same key) queues one email', async () => {
    const { offer } = await customerWithOffer('Same Key');
    const key = newKey();
    await send('desk', offer, 'EMAIL', key);
    await send('desk', offer, 'EMAIL', key);
    expect(await EmailOutbox.countDocuments({ 'ref.offerId': offer._id })).toBe(1);
  });

  it('permission withdrawn after queueing: skipped, slot given back, task open again, bell to the sender', async () => {
    const { customer, offer } = await customerWithOffer('Withdrawn');
    await send('desk', offer, 'EMAIL');
    await Customer.updateOne({ _id: customer._id }, { $set: { 'marketing.EMAIL.status': 'OPTED_OUT' } });
    await processOutbox();

    const row = await EmailOutbox.findOne({ 'ref.offerId': offer._id }).lean();
    expect(row).toMatchObject({ status: 'SKIPPED', lastError: 'The customer no longer allows offer emails.' });
    const saved = await offerById(offer._id);
    expect(saved.task).toMatchObject({ state: 'OPEN', emailStatus: 'FAILED', emailError: 'The customer no longer allows offer emails.', sentAt: null, sentVia: null, contactedAt: null, outcome: null });
    expect((await customerById(customer._id)).marketing.lastPromoAt).toBeNull();
    expect(await OfferEvent.exists({ offerId: offer._id, kind: 'EMAIL_FAILED' })).toBeTruthy();
    const bell = await Notification.findOne({ userId: kavya._id, link: `/app/occasions?offer=${offer._id}` }).lean();
    expect(bell.message).toContain('The offer email to Withdrawn wasn’t sent');
    expect(await ActivityLog.findOne({ action: 'occasions.email_failed', actorName: 'Kavya', actorRole: 'Front desk' })).toBeTruthy();
  });

  it('a bad address fails, the slot is given back, and sending again works', async () => {
    useScript();
    const { customer, offer } = await customerWithOffer('Bad Address', { email: 'bad@mail.com' });
    script.reply = () => ({ status: 'success', results: [{ status: 'failed', message: 'Invalid email: bad@mail.com' }] });
    await send('desk', offer, 'EMAIL');
    await processOutbox();
    let saved = await offerById(offer._id);
    expect(saved.task).toMatchObject({ state: 'OPEN', emailStatus: 'FAILED', emailError: 'The email address isn’t valid.' });
    expect((await customerById(customer._id)).marketing.lastPromoAt).toBeNull();

    // The address is fixed and the email goes out
    script.reply = null;
    expect((await preview('desk', offer, 'EMAIL')).json.allowed).toBe(true);
    expect((await send('desk', offer, 'EMAIL')).status).toBe(200);
    await processOutbox();
    saved = await offerById(offer._id);
    expect(saved.task).toMatchObject({ state: 'CONTACTED', emailStatus: 'SENT' });
    expect(await EmailOutbox.countDocuments({ 'ref.offerId': offer._id })).toBe(2);
  });

  it('a result from an older send never overwrites the newer one', async () => {
    const { offer } = await customerWithOffer('Older');
    await send('desk', offer, 'EMAIL');
    const first = await EmailOutbox.findOne({ 'ref.offerId': offer._id }).lean();
    await OfferIssue.updateOne({ _id: offer._id }, { $set: { 'task.emailOutboxId': new mongoose.Types.ObjectId() } }); // as if sent again
    await processOutbox();
    const row = await EmailOutbox.findById(first._id).lean();
    expect(row, JSON.stringify(row)).toMatchObject({ status: 'SENT' });
    expect((await offerById(offer._id)).task.emailStatus).toBe('QUEUED');
  });

  it('with email not set up (production), Email still opens the mailto: link as before', async () => {
    configureMail({ mode: 'off' });
    const { offer } = await customerWithOffer('Old Way', { email: 'old.way@mail.com' });
    expect((await preview('desk', offer, 'EMAIL')).json.appSends).toBe(false);
    const sent = await send('desk', offer, 'EMAIL');
    expect(sent.json.link).toMatch(/^mailto:old\.way@mail\.com\?subject=/);
    expect(sent.json.queued).toBeUndefined();
    expect(await EmailOutbox.countDocuments({ 'ref.offerId': offer._id })).toBe(0);
    expect((await offerById(offer._id)).task.emailStatus).toBeNull();
  });

  it('WhatsApp and SMS are unchanged: a link, no email', async () => {
    const { offer } = await customerWithOffer('Whats', { marketing: { WHATSAPP: { status: 'OPTED_IN' }, EMAIL: { status: 'OPTED_IN' } } });
    const sent = await send('desk', offer, 'WHATSAPP');
    expect(sent.json.link).toMatch(/^https:\/\/wa\.me\/91/);
    expect(await EmailOutbox.countDocuments({ 'ref.offerId': offer._id })).toBe(0);
  });

  it('the customer’s name with HTML in it is escaped in the email', async () => {
    const { offer } = await customerWithOffer('<b>Zara</b> Khan');
    await send('desk', offer, 'EMAIL');
    const row = await EmailOutbox.findOne({ 'ref.offerId': offer._id }).lean();
    expect(row.html).toContain('Hi &lt;b&gt;Zara&lt;/b&gt;,');
    expect(row.html).not.toContain('<b>Zara</b>');
  });

  it('the front desk can’t send for another branch’s customer', async () => {
    const { offer } = await customerWithOffer('Bandra Person', { branch: f.bandra });
    expect((await send('desk', offer, 'EMAIL')).status).toBe(404);
    expect((await send('bandraDesk', offer, 'EMAIL')).status).toBe(200);
  });
});

describe('the unsubscribe link', () => {
  const page = (token, method = 'GET', body) =>
    fetch(`${origin}/api/public/unsubscribe/${token}`, { method, body, headers: body ? { 'content-type': 'application/x-www-form-urlencoded' } : {} }).then(async (res) => ({ status: res.status, html: await res.text() }));

  it('opening the link changes nothing; pressing Unsubscribe opts out of Email only, with a history row', async () => {
    const { customer } = await customerWithOffer('Leaving', { marketing: { EMAIL: { status: 'OPTED_IN' }, WHATSAPP: { status: 'OPTED_IN' } } });
    const token = unsubscribeToken(g, customer._id);

    const opened = await page(token);
    expect(opened.status).toBe(200);
    expect(opened.html).toContain('Stop offer emails from Glamour?');
    expect(opened.html).toContain('<form method="post">');
    expect((await customerById(customer._id)).marketing.EMAIL.status).toBe('OPTED_IN');

    const pressed = await page(token, 'POST');
    expect(pressed.html).toContain('You’re unsubscribed');
    const after = await customerById(customer._id);
    expect(after.marketing.EMAIL).toMatchObject({ status: 'OPTED_OUT', source: 'CUSTOMER_REQUEST', evidence: 'Email unsubscribe link' });
    expect(after.marketing.WHATSAPP.status).toBe('OPTED_IN');
    const history = await ConsentEvent.find({ customerId: customer._id }).lean();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ channel: 'EMAIL', from: 'OPTED_IN', to: 'OPTED_OUT', source: 'CUSTOMER_REQUEST', actorId: null, actorName: 'Customer' });

    // Pressing again is harmless
    const again = await page(token, 'POST');
    expect(again.status).toBe(200);
    expect(await ConsentEvent.countDocuments({ customerId: customer._id })).toBe(1);
    // The offer list follows straight away
    expect((await OfferIssue.findOne({ customerId: customer._id }).lean()).channels).toEqual(['WHATSAPP']);
  });

  it('Gmail’s one-click unsubscribe (a form POST) works too', async () => {
    const { customer } = await customerWithOffer('One Click');
    const res = await page(unsubscribeToken(g, customer._id), 'POST', 'List-Unsubscribe=One-Click');
    expect(res.status).toBe(200);
    expect((await customerById(customer._id)).marketing.EMAIL.status).toBe('OPTED_OUT');
  });

  it('a forged, changed or other-salon token is refused', async () => {
    const { customer } = await customerWithOffer('Safe');
    const token = unsubscribeToken(g, customer._id);
    const [data, sig] = token.split('.');
    const forged = `${data}.${sig.slice(0, -2)}${sig.endsWith('AA') ? 'BB' : 'AA'}`;
    const otherCustomer = unsubscribeToken(g, new mongoose.Types.ObjectId());
    const otherSalon = unsubscribeToken(f.ctxDesert.orgId, customer._id); // properly signed, but not that salon's customer
    for (const bad of [forged, otherCustomer, otherSalon, 'nonsense', `${data}.`]) {
      const res = await page(bad, 'POST');
      expect(res.status).toBe(404);
      expect(res.html).toContain('This link isn’t valid');
    }
    expect(readToken(forged)).toBeNull();
    expect((await customerById(customer._id)).marketing.EMAIL.status).toBe('OPTED_IN');
  });

  it('an email queued before the customer unsubscribed is not sent', async () => {
    const { customer, offer } = await customerWithOffer('Changed Mind');
    await send('desk', offer, 'EMAIL');
    await page(unsubscribeToken(g, customer._id), 'POST');
    await processOutbox();
    expect((await EmailOutbox.findOne({ 'ref.offerId': offer._id }).lean()).status).toBe('SKIPPED');
    expect((await offerById(offer._id)).task.emailStatus).toBe('FAILED');
  });
});
