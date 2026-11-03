// Email Part 1: mail foundation — Apps Script with SMTP backup, the outbox (retries, batches, daily limit),
// HTML safety, and the business owner's status and test email routes. fetch (for the script) and nodemailer are fakes.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { EmailOutbox, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { configureMail } from '../src/modules/mail/config.js';
import { cleanSubject, escapeHtml, layout, textToHtml } from '../src/modules/mail/html.js';
import { loggedEmails } from '../src/modules/mail/transport/send.js';
import { onAttachment, onBeforeSend, onResult, processOutbox, queueEmail, resetMailer, mailerPausedUntil } from '../src/modules/mail/outbox.js';
import { resetSmtp } from '../src/modules/mail/transport/smtp.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

// --- Fake Gmail SMTP (nodemailer) ---
const smtp = vi.hoisted(() => ({ sent: [], fail: null }));
vi.mock('nodemailer', () => ({
  default: {
    createTransport: () => ({
      async sendMail(message) {
        const err = smtp.fail?.(message);
        if (err) throw err;
        smtp.sent.push(message);
        return { messageId: 'fake' };
      },
      close() {},
    }),
  },
}));

// --- Fake Apps Script (every other fetch, like the test's own API calls, is real) ---
const SCRIPT = 'https://script.google.com/macros/s/fake-script/exec';
const SECRET = 'a-secret-that-is-long-enough-123';
const script = { calls: [], reply: null };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, options = {}) => {
  if (!String(url).startsWith(SCRIPT)) return realFetch(url, options);
  if (!options.method || options.method === 'GET') return new Response(JSON.stringify({ status: 'ok' }), { status: 200 });
  const payload = JSON.parse(options.body);
  script.calls.push(payload);
  const answer = (await script.reply?.(payload)) ?? { status: 200, body: JSON.stringify({ status: 'success' }) };
  if (answer instanceof Error) throw answer;
  return new Response(answer.body, { status: answer.status ?? 200, headers: { 'content-type': answer.type ?? 'application/json' } });
};
const json = (obj, status = 200) => ({ status, body: JSON.stringify(obj) });
const QUOTA = 'Service invoked too many times for one day: email.';

const SMTP_ON = { host: 'smtp.gmail.com', port: 587, user: 'sender@gmail.com', pass: 'app-password' };
const SMTP_OFF = { ...SMTP_ON, user: null, pass: null };
function useMail({ scriptOn = true, smtpOn = true, dailyLimit = 1000 } = {}) {
  configureMail({ scriptUrl: scriptOn ? SCRIPT : null, scriptSecret: scriptOn ? SECRET : null, smtp: smtpOn ? SMTP_ON : SMTP_OFF, dailyLimit });
}

const PASSWORD = 'Password@123';
let server;
let api;
let f;
const cookies = {};
let anita;

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}
async function call(who, method, path, { key = method === 'GET' ? null : `test-${new mongoose.Types.ObjectId()}` } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who] };
  if (key) headers['idempotency-key'] = key;
  const res = await fetch(`${api}${path}`, { method, headers });
  return { status: res.status, json: await res.json().catch(() => null) };
}

let n = 0;
const queue = (overrides = {}, ctx = f.ctxGlamour) =>
  queueEmail(ctx, {
    kind: 'TEST',
    dedupeKey: `t:${++n}`,
    to: `person${n}@example.org`,
    subject: 'Hello',
    text: 'Hi there',
    html: '<p>Hi there</p>',
    fromName: 'Glamour',
    replyTo: 'a@a.com',
    ...overrides,
  });
const row = (id) => EmailOutbox.findById(id).lean();
const makeDue = () => EmailOutbox.updateMany({ status: 'PENDING' }, { $set: { nextAttemptAt: new Date(Date.now() - 1000) } });

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const passwordHash = await hashPassword(PASSWORD);
  const g = f.ctxGlamour.orgId;
  [anita] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Bina', email: 'bina@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Omar', email: 'omar@d.com', passwordHash, allBranches: true },
  ]);
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', branchOwner: 'bina@g.com', desk: 'kavya@g.com', otherSalon: 'omar@d.com' })) {
    cookies[who] = await login(email);
  }
});

afterAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300)); // let background sends started by the routes finish
  server?.close();
  configureMail();
  globalThis.fetch = realFetch;
  await stopDb();
});

beforeEach(async () => {
  await EmailOutbox.deleteMany({});
  script.calls = [];
  script.reply = null;
  smtp.sent = [];
  smtp.fail = null;
  resetSmtp();
  resetMailer();
  useMail();
});

describe('Apps Script replies', () => {
  it('sends through the script with the secret, sender name and reply-to', async () => {
    const { id } = await queue();
    await processOutbox();
    const sent = await row(id);
    expect(sent).toMatchObject({ status: 'SENT', via: 'APPS_SCRIPT', attempts: 1 });
    expect(script.calls).toHaveLength(1);
    expect(script.calls[0].secret).toBe(SECRET);
    expect(script.calls[0].emails[0]).toMatchObject({ subject: 'Hello', fromName: 'Glamour', replyTo: 'a@a.com', textBody: 'Hi there' });
    expect(smtp.sent).toHaveLength(0);
  });

  it('an empty or non-JSON reply counts as sent', async () => {
    script.reply = () => ({ status: 200, body: '' });
    const a = await queue();
    await processOutbox();
    script.reply = () => ({ status: 200, body: 'OK', type: 'text/plain' });
    const b = await queue();
    await processOutbox();
    expect((await row(a.id)).status).toBe('SENT');
    expect((await row(b.id)).status).toBe('SENT');
  });

  it('an HTML 404 page means the script is down: SMTP sends it', async () => {
    script.reply = () => ({ status: 404, body: '<!DOCTYPE html><html><body>Not found</body></html>', type: 'text/html' });
    const { id } = await queue();
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'SENT', via: 'SMTP' });
    expect(smtp.sent[0]).toMatchObject({ from: { name: 'Glamour', address: 'sender@gmail.com' }, replyTo: 'a@a.com' });
  });

  it('the quota message moves it to SMTP', async () => {
    script.reply = () => json({ status: 'error', message: QUOTA });
    const { id } = await queue();
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'SENT', via: 'SMTP' });
  });

  it('quota with no SMTP: the email waits an hour (no try used up) and the mailer pauses', async () => {
    useMail({ smtpOn: false });
    script.reply = () => json({ status: 'error', message: QUOTA });
    const { id } = await queue();
    await processOutbox();
    const waiting = await row(id);
    expect(waiting).toMatchObject({ status: 'PENDING', attempts: 0, errorKind: 'QUOTA' });
    expect(waiting.nextAttemptAt.getTime() - Date.now()).toBeGreaterThan(55 * 60 * 1000);
    expect(mailerPausedUntil()).not.toBeNull();

    await queue(); // nothing goes out while paused
    expect(await processOutbox()).toBe(0);
    expect(script.calls).toHaveLength(1);
  });

  it('a bad address fails at once and is not sent to SMTP', async () => {
    script.reply = () => json({ status: 'error', message: 'Invalid email: not-an-address' });
    const { id } = await queue();
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'FAILED', errorKind: 'BAD_ADDRESS', lastError: 'The email address isn’t valid.' });
    expect(smtp.sent).toHaveLength(0);
  });

  it('a wrong secret fails with a plain reason', async () => {
    script.reply = () => json({ status: 'error', message: 'unauthorised' });
    const { id } = await queue();
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'FAILED', errorKind: 'UNAUTHORISED' });
    expect((await row(id)).lastError).toMatch(/MAIL_SCRIPT_SECRET/);
  });

  it('a timeout is tried again after 1, 5, 15 and 60 minutes, then fails after 5 tries', async () => {
    useMail({ smtpOn: false });
    script.reply = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const { id } = await queue();
    const waits = [];
    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const before = Date.now();
      await processOutbox();
      const r = await row(id);
      expect(r).toMatchObject({ status: 'PENDING', attempts: attempt, errorKind: 'TIMEOUT' });
      waits.push(Math.round((r.nextAttemptAt.getTime() - before) / 60_000));
      await makeDue();
    }
    expect(waits).toEqual([1, 5, 15, 60]);
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'FAILED', attempts: 5, errorKind: 'TIMEOUT' });
  });

  it('a timeout is not moved to SMTP (only quota and a dead script are)', async () => {
    script.reply = () => Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    await queue();
    await processOutbox();
    expect(smtp.sent).toHaveLength(0);
  });
});

describe('attachments', () => {
  const pdf = Buffer.from('%PDF-1.4 fake');
  beforeAll(() => onAttachment('INVOICE', async () => ({ fileName: 'bill.pdf', mimeType: 'application/pdf', content: pdf })));

  it('an email with a PDF goes by SMTP first', async () => {
    const { id } = await queue({ kind: 'BILL', attachment: { type: 'INVOICE', id: new mongoose.Types.ObjectId() } });
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'SENT', via: 'SMTP' });
    expect(smtp.sent[0].attachments[0]).toMatchObject({ filename: 'bill.pdf', contentType: 'application/pdf' });
    expect(script.calls).toHaveLength(0);
  });

  it('SMTP down: the script sends it, with the PDF as base64', async () => {
    smtp.fail = () => Object.assign(new Error('Connection timeout'), { code: 'ETIMEDOUT' });
    const { id } = await queue({ kind: 'BILL', attachment: { type: 'INVOICE', id: new mongoose.Types.ObjectId() } });
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'SENT', via: 'APPS_SCRIPT' });
    expect(script.calls[0].attachments[0]).toEqual({ fileName: 'bill.pdf', mimeType: 'application/pdf', base64: pdf.toString('base64') });
  });
});

describe('batches', () => {
  it('45 emails go in two calls (40 + 5); after a quota stop the rest go by SMTP', async () => {
    script.reply = (payload) => {
      if (script.calls.length === 1) {
        // the first 10 sent, the 11th hits the quota, the script skips the rest
        return json({
          status: 'success',
          results: payload.emails.map((_, i) => (i < 10 ? { status: 'sent' } : i === 10 ? { status: 'failed', message: QUOTA } : { status: 'failed', skipped: true, message: QUOTA })),
        });
      }
      return json({ status: 'error', message: QUOTA });
    };
    for (let i = 0; i < 45; i += 1) await queue();
    await processOutbox();

    expect(script.calls.map((c) => c.emails.length)).toEqual([40, 5]);
    const counts = await EmailOutbox.aggregate([{ $group: { _id: { status: '$status', via: '$via' }, n: { $sum: 1 } } }]);
    const byRoute = Object.fromEntries(counts.map((c) => [`${c._id.status}:${c._id.via}`, c.n]));
    expect(byRoute).toEqual({ 'SENT:APPS_SCRIPT': 10, 'SENT:SMTP': 35 });
  });

  it('two mailers running at once send each email exactly once', async () => {
    script.reply = async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
      return json({ status: 'success' });
    };
    for (let i = 0; i < 30; i += 1) await queue();
    await Promise.all([processOutbox(), processOutbox()]);
    const sentTo = script.calls.flatMap((c) => c.emails.map((e) => e.to));
    expect(sentTo).toHaveLength(30);
    expect(new Set(sentTo).size).toBe(30);
    expect(await EmailOutbox.countDocuments({ status: 'SENT' })).toBe(30);
  });

  it('a row cut off by a restart (stuck in SENDING) is picked up again', async () => {
    const { id } = await queue();
    await EmailOutbox.updateOne({ _id: id }, { $set: { status: 'SENDING', lockedUntil: new Date(Date.now() - 1000), attempts: 1 } });
    await processOutbox();
    expect(await row(id)).toMatchObject({ status: 'SENT', attempts: 2 });
  });

  it('queueing the same email twice keeps one row', async () => {
    const a = await queue({ dedupeKey: 'same' });
    const b = await queue({ dedupeKey: 'same', subject: 'Other' });
    expect(String(a.id)).toBe(String(b.id));
    expect(await EmailOutbox.countDocuments({ dedupeKey: 'same' })).toBe(1);
  });
});

describe('daily limit', () => {
  it('at the limit, automatic offers (priority 5) wait but password emails (priority 1) still go', async () => {
    useMail({ dailyLimit: 3 });
    const sentAt = new Date();
    await EmailOutbox.create(
      [1, 2, 3].map((i) => ({ orgId: f.ctxDesert.orgId, kind: 'TEST', priority: 2, to: `x${i}@x.org`, subject: 's', html: 'h', text: 't', fromName: 'D', dedupeKey: `old${i}`, status: 'SENT', via: 'APPS_SCRIPT', sentAt }))
    );
    const offer = await queue({ priority: 5 }); // like an automatic offer email
    const password = await queue({ kind: 'PASSWORD' });
    await processOutbox();
    expect((await row(password.id)).status).toBe('SENT');
    expect((await row(offer.id)).status).toBe('PENDING');
  });

  it('emails only logged (email not set up) do not count towards it', async () => {
    useMail({ scriptOn: false, smtpOn: false, dailyLimit: 1 });
    const ids = [await queue(), await queue({ priority: 5 })];
    await processOutbox();
    for (const { id } of ids) expect(await row(id)).toMatchObject({ status: 'SENT', via: 'LOG' });
  });
});

describe('hooks', () => {
  it('a check before sending can skip an email, and the result hook hears about it', async () => {
    const heard = [];
    const realCheck = onBeforeSend('OCCASION_OFFER', async () => ({ skip: true, reason: 'Permission withdrawn' }));
    const realResult = onResult('OCCASION_OFFER', async (r) => heard.push(r.status));
    try {
      const { id } = await queue({ kind: 'OCCASION_OFFER' });
      await processOutbox();
      expect(await row(id)).toMatchObject({ status: 'SKIPPED', lastError: 'Permission withdrawn' });
      expect(heard).toEqual(['SKIPPED']);
      expect(script.calls).toHaveLength(0);
    } finally {
      onBeforeSend('OCCASION_OFFER', realCheck);
      onResult('OCCASION_OFFER', realResult);
    }
  });
});

describe('HTML safety', () => {
  it('user text is escaped; line breaks become <br>', () => {
    expect(textToHtml('Hi <script>alert(1)</script>\nBye & "you"')).toBe('Hi &lt;script&gt;alert(1)&lt;/script&gt;<br>Bye &amp; &quot;you&quot;');
    expect(escapeHtml("O'Neil")).toBe('O&#39;Neil');
    const html = layout({ salonName: '<b>Evil</b> Salon', body: textToHtml('x') });
    expect(html).toContain('&lt;b&gt;Evil&lt;/b&gt; Salon');
    expect(html).not.toContain('<b>Evil</b>');
  });

  it('a subject with a line break is cleaned before it is stored', async () => {
    expect(cleanSubject('Offer\r\nBcc: everyone@x.org')).toBe('Offer Bcc: everyone@x.org');
    const { id } = await queue({ subject: 'Hi\nBcc: x@x.org', fromName: 'Glam\r\nour' });
    expect(await row(id)).toMatchObject({ subject: 'Hi Bcc: x@x.org', fromName: 'Glam our' });
  });
});

describe('status and test email routes', () => {
  it('only the business owner can open them', async () => {
    expect((await call('business', 'GET', '/mail/status')).status).toBe(200);
    for (const who of ['branchOwner', 'desk']) {
      expect((await call(who, 'GET', '/mail/status')).status).toBe(403);
      expect((await call(who, 'POST', '/mail/test')).status).toBe(403);
    }
  });

  it('status shows the routes, the script health and the limit', async () => {
    const { json: status } = await call('business', 'GET', '/mail/status');
    expect(status).toMatchObject({ mode: 'live', setUp: true, routes: { appsScript: true, smtp: true }, script: { reachable: true }, dailyLimit: 1000, testTo: 'anita@g.com' });
  });

  it('the test email goes to the business owner, from the salon, and the card can follow it', async () => {
    const queued = await call('business', 'POST', '/mail/test');
    expect(queued.status).toBe(202);
    expect(queued.json.to).toBe('anita@g.com');
    await processOutbox();
    const state = await call('business', 'GET', `/mail/test/${queued.json.id}`);
    expect(state.json).toMatchObject({ status: 'SENT', via: 'APPS_SCRIPT', error: null });
    const email = script.calls.at(-1).emails[0];
    expect(email).toMatchObject({ to: 'anita@g.com', fromName: 'Glamour', replyTo: 'a@a.com', subject: 'Test email from Glamour' });
    expect(email.textBody).toContain('Hello Anita');
  });

  it('pressing the button twice with the same request key queues one email', async () => {
    const key = `test-${new mongoose.Types.ObjectId()}`;
    const [a, b] = await Promise.all([call('business', 'POST', '/mail/test', { key }), call('business', 'POST', '/mail/test', { key })]);
    expect(a.json.id).toBe(b.json.id);
    expect(await EmailOutbox.countDocuments({ kind: 'TEST' })).toBe(1);
  });

  it('a failed test email shows the reason in plain words', async () => {
    script.reply = () => json({ status: 'error', message: 'unauthorised' });
    const queued = await call('business', 'POST', '/mail/test');
    await processOutbox();
    const state = await call('business', 'GET', `/mail/test/${queued.json.id}`);
    expect(state.json.status).toBe('FAILED');
    expect(state.json.error).toMatch(/refused the secret/);
  });

  it('with email not set up (development), the test email is logged, not sent', async () => {
    useMail({ scriptOn: false, smtpOn: false });
    expect((await call('business', 'GET', '/mail/status')).json).toMatchObject({ mode: 'log', setUp: false, script: null });
    const queued = await call('business', 'POST', '/mail/test');
    await processOutbox();
    expect((await call('business', 'GET', `/mail/test/${queued.json.id}`)).json).toMatchObject({ status: 'SENT', via: 'LOG' });
    expect(loggedEmails().at(-1).to).toBe('anita@g.com');
  });

  it('another salon never sees this salon’s emails', async () => {
    const queued = await call('business', 'POST', '/mail/test');
    await processOutbox();
    expect((await call('otherSalon', 'GET', `/mail/test/${queued.json.id}`)).status).toBe(404);
    const theirs = await call('otherSalon', 'GET', '/mail/status');
    expect(theirs.json.salon).toEqual({ sentLast24h: 0, failedLast7Days: 0, waiting: 0 });
    expect(theirs.json.testTo).toBe('omar@d.com');
    expect(anita.email).toBe('anita@g.com');
  });
});
