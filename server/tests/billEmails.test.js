// Email Part 5: email a bill with its PDF, the recent emails list for owners, and all four kinds of email under
// the daily limit. Email is in "log" mode unless a test turns on the fake Apps Script.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { ActivityLog, Appointment, Customer, EmailOutbox, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { configureMail } from '../src/modules/mail/config.js';
import { holdMailer, onBeforeSend, processOutbox, queueEmail, resetMailer } from '../src/modules/mail/outbox.js';
import { loggedEmails } from '../src/modules/mail/transport/send.js';
import { openDraft } from '../src/modules/invoices/invoices.service.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout } from './billing.js';

// The fake Apps Script (for the daily limit test)
const SCRIPT = 'https://script.google.com/macros/s/fake-bills/exec';
const script = { calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith(SCRIPT)) return realFetch(url, options);
  script.calls.push(JSON.parse(options.body));
  return new Response(JSON.stringify({ status: 'success' }), { status: 200 });
};

const PASSWORD = 'Password@123';
let server;
let api;
let f;
let g;
let desk;
let bandraOwner;
const cookies = {};
const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}
async function call(who, method, path, { body, key = method === 'GET' ? null : newKey() } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who] };
  if (key) headers['idempotency-key'] = key;
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// A finished appointment, checked out (issued and paid)
async function issuedBill(branch = f.andheri, ctx = desk, customer = f.priya) {
  const start = new Date();
  const stylist = branch === f.andheri ? f.rahul : f.arjun;
  const appointment = await Appointment.create({
    orgId: g, branchId: branch._id, customerId: customer._id, customerSnapshot: { name: customer.name, phone: customer.phone },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: stylist._id, staffName: stylist.name, startAt: start, endAt: start, durationMinutes: 30, price: 50000 }],
    startAt: start, endAt: start, totalPrice: 50000, status: 'COMPLETED',
  });
  return checkout(ctx, appointment);
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const [, vikram, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Omar', email: 'omar@d.com', passwordHash, allBranches: true },
  ]);
  desk = { ...f.ctxGlamour, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)], activeBranchId: String(f.andheri._id) };
  bandraOwner = { ...f.ctxGlamour, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
  await Customer.updateOne({ _id: f.priya._id }, { $set: { email: 'priya.sharma@mail.com' } });
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', branchOwner: 'vikram@g.com', desk: 'kavya@g.com', otherSalon: 'omar@d.com' })) cookies[who] = await login(email);
  holdMailer();
});

afterAll(async () => {
  holdMailer(false);
  configureMail();
  globalThis.fetch = realFetch;
  server?.close();
  await stopDb();
});

beforeEach(async () => {
  configureMail();
  resetMailer();
  script.calls = [];
  await EmailOutbox.deleteMany({});
});

describe('emailing a bill', () => {
  it('goes to the customer’s email with the bill as a PDF; the bill page follows it', async () => {
    const bill = await issuedBill();
    const before = await call('desk', 'GET', `/invoices/${bill._id}/emails`);
    expect(before.json).toMatchObject({ customerEmail: 'pr***@mail.com', canEmail: true, emails: [] });

    const sent = await call('desk', 'POST', `/invoices/${bill._id}/email`, { body: {} });
    expect(sent).toMatchObject({ status: 202, json: { to: 'pr***@mail.com', status: 'PENDING' } });
    const row = await EmailOutbox.findOne({ 'ref.invoiceId': bill._id }).lean();
    expect(row).toMatchObject({ kind: 'BILL', priority: 3, to: 'priya.sharma@mail.com', fromName: 'Glamour', replyTo: 'a@a.com', attachment: { type: 'INVOICE' } });
    expect(row.subject).toBe(`Your bill ${bill.invoiceNumber} from Glamour`);

    await processOutbox();
    const email = loggedEmails().at(-1);
    expect(email.to).toBe('priya.sharma@mail.com');
    expect(email.attachments[0]).toMatchObject({ mimeType: 'application/pdf', fileName: `Bill_${bill.invoiceNumber.replace(/[^a-z0-9]+/gi, '-')}.pdf` });
    expect(email.attachments[0].content.subarray(0, 5).toString()).toBe('%PDF-');
    expect(email.textBody).toContain('Hi Priya');

    const after = await call('desk', 'GET', `/invoices/${bill._id}/emails`);
    expect(after.json.emails[0]).toMatchObject({ to: 'pr***@mail.com', status: 'SENT', by: 'Kavya' });
    expect(await ActivityLog.exists({ action: 'billing.bill_emailed', invoiceId: bill._id })).toBeTruthy();
  });

  it('can go to another address; a bad one is refused; a customer with no email needs one typed in', async () => {
    const bill = await issuedBill();
    expect((await call('desk', 'POST', `/invoices/${bill._id}/email`, { body: { to: 'Someone.Else@Mail.com' } })).json.to).toBe('so***@mail.com');
    expect((await EmailOutbox.findOne({ 'ref.invoiceId': bill._id }).lean()).to).toBe('someone.else@mail.com');
    expect((await call('desk', 'POST', `/invoices/${bill._id}/email`, { body: { to: 'not-an-email' } })).status).toBe(400);

    const noEmail = await Customer.create({ orgId: g, name: 'No Mail', phone: '9811100099' });
    const plain = await issuedBill(f.andheri, desk, noEmail);
    const refused = await call('desk', 'POST', `/invoices/${plain._id}/email`, { body: {} });
    expect(refused).toMatchObject({ status: 400, json: { error: { code: 'NO_EMAIL' } } });
  });

  it('a draft bill is refused', async () => {
    const start = new Date();
    const appointment = await Appointment.create({
      orgId: g, branchId: f.andheri._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
      items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price: 50000 }],
      startAt: start, endAt: start, totalPrice: 50000, status: 'COMPLETED',
    });
    const draft = await openDraft(desk, { appointmentId: appointment._id });
    expect((await call('desk', 'POST', `/invoices/${draft._id}/email`, { body: {} })).json.error.code).toBe('NOT_ISSUED');
  });

  it('the front desk only for their branch; a branch owner only for theirs; another salon never', async () => {
    const andheri = await issuedBill();
    const bandra = await issuedBill(f.bandra, bandraOwner);
    expect((await call('desk', 'POST', `/invoices/${bandra._id}/email`, { body: {} })).status).toBe(404);
    expect((await call('branchOwner', 'POST', `/invoices/${andheri._id}/email`, { body: {} })).status).toBe(404);
    expect((await call('branchOwner', 'POST', `/invoices/${bandra._id}/email`, { body: {} })).status).toBe(202);
    expect((await call('otherSalon', 'POST', `/invoices/${andheri._id}/email`, { body: {} })).status).toBe(404);
    expect((await call('otherSalon', 'GET', `/invoices/${andheri._id}/emails`)).status).toBe(404);
  });

  it('with email not set up there’s no Email bill (and a clear refusal)', async () => {
    configureMail({ mode: 'off' });
    const bill = await issuedBill();
    expect((await call('desk', 'GET', `/invoices/${bill._id}/emails`)).json.canEmail).toBe(false);
    expect((await call('desk', 'POST', `/invoices/${bill._id}/email`, { body: {} })).json.error.code).toBe('MAIL_NOT_SET_UP');
  });
});

describe('recent emails', () => {
  async function fill() {
    const bandra = await issuedBill(f.bandra, bandraOwner);
    await call('branchOwner', 'POST', `/invoices/${bandra._id}/email`, { body: {} });
    const andheri = await issuedBill();
    await call('desk', 'POST', `/invoices/${andheri._id}/email`, { body: { to: 'bad@mail.com' } });
    await call('business', 'POST', '/mail/test');
    await queueEmail(f.ctxGlamour, { kind: 'PASSWORD', dedupeKey: 'pw-1', to: 'kavya@g.com', subject: 'Reset your GrowwPilot password', text: 'link', html: 'link', fromName: 'GrowwPilot' });
    await processOutbox();
    await EmailOutbox.updateOne({ to: 'bad@mail.com' }, { $set: { status: 'FAILED', lastError: 'The email address isn’t valid.' } });
  }

  it('the business owner sees every email, without its body, addresses partly hidden', async () => {
    await fill();
    const { json } = await call('business', 'GET', '/mail/log');
    expect(json.total).toBe(4);
    expect(json.emails.map((e) => e.kind).sort()).toEqual(['BILL', 'BILL', 'PASSWORD', 'TEST']);
    for (const e of json.emails) {
      expect(e.html).toBeUndefined();
      expect(e.text).toBeUndefined();
      expect(e.to).toMatch(/\*\*\*@/);
    }
    expect(json.emails.find((e) => e.kind === 'PASSWORD').subject).toBe('Password link');
    expect(json.emails.find((e) => e.status === 'FAILED')).toMatchObject({ error: 'The email address isn’t valid.', branchName: 'Andheri', by: 'Kavya' });
  });

  it('filters by kind, status and date', async () => {
    await fill();
    expect((await call('business', 'GET', '/mail/log?kind=BILL')).json.total).toBe(2);
    expect((await call('business', 'GET', '/mail/log?status=FAILED')).json.total).toBe(1);
    const today = new Date().toISOString().slice(0, 10);
    expect((await call('business', 'GET', `/mail/log?from=2020-01-01&to=2020-12-31`)).json.total).toBe(0);
    expect((await call('business', 'GET', `/mail/log?from=${today}`)).json.total).toBeGreaterThan(0);
    expect((await call('business', 'GET', '/mail/log?kind=NOPE')).status).toBe(400);
  });

  it('a branch owner sees only their branches; the front desk none; another salon none of these', async () => {
    await fill();
    const theirs = await call('branchOwner', 'GET', '/mail/log');
    expect(theirs.json.emails.map((e) => [e.kind, e.branchName])).toEqual([['BILL', 'Bandra']]);
    expect((await call('branchOwner', 'GET', '/mail/status')).status).toBe(403); // the setup stays with the business owner
    expect((await call('desk', 'GET', '/mail/log')).status).toBe(403);
    expect((await call('otherSalon', 'GET', '/mail/log')).json.total).toBe(0);
  });
});

describe('all four kinds under the daily limit', () => {
  it('at the limit only password and test emails go; the rest go once there is room', async () => {
    configureMail({ scriptUrl: SCRIPT, scriptSecret: 'a-secret-that-is-long-enough-123', dailyLimit: 3 });
    const realCheck = onBeforeSend('OCCASION_OFFER', null); // an offer row without a real offer behind it
    try {
      const sentAt = new Date();
      await EmailOutbox.create([1, 2, 3].map((i) => ({ orgId: f.ctxDesert.orgId, kind: 'TEST', priority: 2, to: `x${i}@x.org`, subject: 's', html: 'h', text: 't', fromName: 'D', dedupeKey: `old${i}`, status: 'SENT', via: 'APPS_SCRIPT', sentAt })));
      const bill = await issuedBill();
      await call('desk', 'POST', `/invoices/${bill._id}/email`, { body: {} });
      await call('business', 'POST', '/mail/test');
      const base = { text: 't', html: 'h', fromName: 'Glamour', to: 'someone@mail.com' };
      await queueEmail(f.ctxGlamour, { ...base, kind: 'PASSWORD', dedupeKey: 'pw', subject: 'Reset' });
      await queueEmail(f.ctxGlamour, { ...base, kind: 'OCCASION_OFFER', dedupeKey: 'offer', subject: 'Offer' });
      await queueEmail(f.ctxGlamour, { ...base, kind: 'OCCASION_OFFER', priority: 5, dedupeKey: 'auto', subject: 'Auto offer' });

      await processOutbox();
      const status = async () => Object.fromEntries((await EmailOutbox.find({ orgId: g }).lean()).map((r) => [`${r.kind}:${r.priority}`, r.status]));
      expect(await status()).toEqual({ 'BILL:3': 'PENDING', 'TEST:2': 'SENT', 'PASSWORD:1': 'SENT', 'OCCASION_OFFER:4': 'PENDING', 'OCCASION_OFFER:5': 'PENDING' });

      configureMail({ dailyLimit: 100 });
      await processOutbox();
      expect(Object.values(await status()).every((s) => s === 'SENT')).toBe(true);
      const bySubject = script.calls.flatMap((c) => (c.emails ?? [c]).map((e) => e.subject));
      expect(bySubject).toContain(`Your bill ${bill.invoiceNumber} from Glamour`);
      const billCall = script.calls.find((c) => c.attachments);
      expect(billCall.attachments[0].mimeType).toBe('application/pdf'); // no SMTP here, so the PDF went by the script
    } finally {
      onBeforeSend('OCCASION_OFFER', realCheck);
    }
  });
});
