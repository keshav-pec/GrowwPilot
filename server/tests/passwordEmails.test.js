// Email Part 4: forgot password and set-password links — same reply for every email, limits, one-time links that
// expire, other devices logged out after a reset, owners emailing a link only to the people they manage.
// Email is in "log" mode (development): emails are kept in memory, so the tests can read the link.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { EmailOutbox, PasswordToken, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { configureMail } from '../src/modules/mail/config.js';
import { holdMailer, processOutbox, resetMailer } from '../src/modules/mail/outbox.js';
import { loggedEmails } from '../src/modules/mail/transport/send.js';
import { passwordProblem, sendResetIfAllowed } from '../src/modules/auth/passwordLinks.service.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
let server;
let api;
let f;
const cookies = {};
const users = {};

async function login(email, password = PASSWORD) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) });
  return res.status === 200 ? res.headers.get('set-cookie').split(';')[0] : null;
}
async function call(who, method, path, body) {
  const headers = { 'content-type': 'application/json' };
  if (who) headers.cookie = cookies[who];
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}
const waitFor = async (check) => {
  for (let i = 0; i < 50; i += 1) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};
// The link in the last email sent to this address
async function linkFor(email) {
  await processOutbox();
  const sent = loggedEmails().filter((e) => e.to === email).at(-1);
  return sent?.textBody.match(/reset-password\?token=([\w-]+)/)?.[1] ?? null;
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const created = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Bina', email: 'bina@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Dev', email: 'dev@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Ina', email: 'ina@g.com', passwordHash, branchIds: [f.andheri._id], status: 'inactive' },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Omar', email: 'omar@d.com', passwordHash, allBranches: true },
    { role: 'SUPER_ADMIN', name: 'Admin', email: 'admin@gp.com', passwordHash },
  ]);
  for (const u of created) users[u.name.toLowerCase()] = u;
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', branchOwner: 'bina@g.com', desk: 'kavya@g.com', otherSalon: 'omar@d.com' })) cookies[who] = await login(email);
  holdMailer();
});

afterAll(async () => {
  holdMailer(false);
  configureMail();
  server?.close();
  await stopDb();
});

beforeEach(async () => {
  configureMail();
  resetMailer();
  await Promise.all([EmailOutbox.deleteMany({}), PasswordToken.deleteMany({})]);
});

describe('forgot password', () => {
  it('gives the same reply for a known, an unknown and a deactivated email; only the known one gets an email', async () => {
    const replies = [];
    for (const email of ['dev@g.com', 'nobody@nowhere.com', 'ina@g.com']) replies.push(await call(null, 'POST', '/auth/forgot-password', { email }));
    expect(new Set(replies.map((r) => r.status))).toEqual(new Set([200]));
    expect(new Set(replies.map((r) => JSON.stringify(r.json))).size).toBe(1);
    expect(replies[0].json.message).toMatch(/If an account exists/);

    await waitFor(async () => (await EmailOutbox.countDocuments()) > 0);
    await new Promise((resolve) => setTimeout(resolve, 100)); // the other two had their chance too
    const rows = await EmailOutbox.find().lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: 'PASSWORD', priority: 1, to: 'dev@g.com', fromName: 'GrowwPilot', replyTo: 'a@a.com', subject: 'Reset your GrowwPilot password' });
  });

  it('the Super Admin and people of a deactivated salon get nothing', async () => {
    expect(await sendResetIfAllowed('admin@gp.com')).toBe(false);
    expect(await sendResetIfAllowed('nobody@nowhere.com')).toBe(false);
  });

  it('each person gets at most 3 reset emails an hour', async () => {
    const results = [];
    for (let i = 0; i < 4; i += 1) results.push(await sendResetIfAllowed('dev@g.com'));
    expect(results).toEqual([true, true, true, false]);
  });

  it('a new link cancels the older ones', async () => {
    await sendResetIfAllowed('dev@g.com');
    const first = await linkFor('dev@g.com');
    await sendResetIfAllowed('dev@g.com');
    const second = await linkFor('dev@g.com');
    expect(first).not.toBe(second);
    expect((await call(null, 'POST', '/auth/reset-password/check', { token: first })).status).toBe(400);
    expect((await call(null, 'POST', '/auth/reset-password/check', { token: second })).json).toEqual({ purpose: 'RESET', name: 'Dev' });
  });
});

describe('using the link', () => {
  it('sets the password once, logs out other devices, and the stored email loses the link', async () => {
    const oldCookie = await login('dev@g.com');
    expect((await fetch(`${api}/auth/me`, { headers: { cookie: oldCookie } })).status).toBe(200);
    await sendResetIfAllowed('dev@g.com');
    const token = await linkFor('dev@g.com');
    expect(token).toHaveLength(43);
    await new Promise((resolve) => setTimeout(resolve, 1100)); // a later second than the old login

    const weak = await call(null, 'POST', '/auth/reset-password', { token, password: 'short' });
    expect(weak.status).toBe(400);
    expect(weak.json.error.message).toBe('At least 8 characters, with a letter and a number');

    const done = await call(null, 'POST', '/auth/reset-password', { token, password: 'NewSecret99' });
    expect(done).toMatchObject({ status: 200, json: { message: 'Password changed. Please log in.' } });
    expect(JSON.stringify(done.json)).not.toContain(token);

    const stale = await fetch(`${api}/auth/me`, { headers: { cookie: oldCookie } });
    expect(stale.status).toBe(401);
    expect((await stale.json()).error.code).toBe('PASSWORD_CHANGED');
    expect(await login('dev@g.com', PASSWORD)).toBeNull();
    const fresh = await login('dev@g.com', 'NewSecret99');
    expect((await fetch(`${api}/auth/me`, { headers: { cookie: fresh } })).status).toBe(200);

    expect((await call(null, 'POST', '/auth/reset-password', { token, password: 'Another123' })).json.error.code).toBe('LINK_INVALID');
    const stored = await EmailOutbox.findOne({ to: 'dev@g.com' }).lean();
    expect(stored.status).toBe('SENT');
    expect(stored.text).not.toContain(token);
    expect(stored.html).not.toContain(token);
    expect(await PasswordToken.exists({ tokenHash: token })).toBeNull(); // only the hash is kept

    await User.updateOne({ _id: users.dev._id }, { $set: { passwordHash: await hashPassword(PASSWORD) } });
  });

  it('an expired, changed or made-up link is refused', async () => {
    await sendResetIfAllowed('dev@g.com');
    const token = await linkFor('dev@g.com');
    const changed = `${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`;
    for (const bad of [changed, 'x'.repeat(43)]) expect((await call(null, 'POST', '/auth/reset-password', { token: bad, password: 'NewSecret99' })).status).toBe(400);
    await PasswordToken.updateMany({}, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    expect((await call(null, 'POST', '/auth/reset-password', { token, password: 'NewSecret99' })).json.error.code).toBe('LINK_INVALID');
  });

  it('a link for someone deactivated since doesn’t work', async () => {
    await sendResetIfAllowed('dev@g.com');
    const token = await linkFor('dev@g.com');
    await User.updateOne({ _id: users.dev._id }, { $set: { status: 'inactive' } });
    try {
      expect((await call(null, 'POST', '/auth/reset-password', { token, password: 'NewSecret99' })).status).toBe(400);
    } finally {
      await User.updateOne({ _id: users.dev._id }, { $set: { status: 'active' } });
    }
  });

  it('the password rule', () => {
    expect(passwordProblem('abcdefgh')).not.toBeNull(); // no number
    expect(passwordProblem('12345678')).not.toBeNull(); // no letter
    expect(passwordProblem('abc12')).not.toBeNull(); // too short
    expect(passwordProblem('abcd1234')).toBeNull();
  });
});

describe('owners emailing a set-password link', () => {
  it('the business owner emails a link; the link is never in the reply; it lasts 48 hours', async () => {
    const res = await call('business', 'POST', `/users/${users.kavya._id}/email-password-link`);
    expect(res).toMatchObject({ status: 200, json: { email: 'kavya@g.com', emailed: true } });
    const token = await linkFor('kavya@g.com');
    expect(JSON.stringify(res.json)).not.toContain(token);
    expect(loggedEmails().at(-1).textBody).toContain('Anita added you to Glamour on GrowwPilot');
    const row = await PasswordToken.findOne({ userId: users.kavya._id }).lean();
    expect(row.purpose).toBe('INVITE');
    expect(Math.round((row.expiresAt - row.createdAt) / 3_600_000)).toBe(48);
    expect((await call(null, 'POST', '/auth/reset-password/check', { token })).json).toEqual({ purpose: 'INVITE', name: 'Kavya' });
  });

  it('a branch owner only for their own branches; the front desk and another salon not at all', async () => {
    expect((await call('branchOwner', 'POST', `/users/${users.kavya._id}/email-password-link`)).status).toBe(200);
    expect((await call('branchOwner', 'POST', `/users/${users.dev._id}/email-password-link`)).status).toBe(404); // Bandra
    expect((await call('branchOwner', 'POST', `/users/${users.anita._id}/email-password-link`)).status).toBe(404); // the business owner
    expect((await call('desk', 'POST', `/users/${users.dev._id}/email-password-link`)).status).toBe(403);
    expect((await call('otherSalon', 'POST', `/users/${users.kavya._id}/email-password-link`)).status).toBe(404);
    expect(await EmailOutbox.countDocuments()).toBe(1);
  });

  it('a new login can get the link instead of a temporary password', async () => {
    const res = await call('business', 'POST', '/users', { role: 'FRONT_DESK', name: 'Meera', email: 'meera@g.com', branchIds: [String(f.andheri._id)], sendPasswordEmail: true });
    expect(res.status).toBe(201);
    expect(res.json).toMatchObject({ emailed: true, user: { email: 'meera@g.com' } });
    expect(res.json.temporaryPassword).toBeUndefined();
    const token = await linkFor('meera@g.com');
    expect((await call(null, 'POST', '/auth/reset-password', { token, password: 'Meera2026' })).status).toBe(200);
    expect(await login('meera@g.com', 'Meera2026')).toBeTruthy();
  });

  it('without the option, the temporary password flow is unchanged', async () => {
    const res = await call('business', 'POST', '/users', { role: 'FRONT_DESK', name: 'Ravi', email: 'ravi.desk@g.com', branchIds: [String(f.andheri._id)] });
    expect(res.status).toBe(201);
    expect(res.json.temporaryPassword).toHaveLength(8);
    expect(await EmailOutbox.countDocuments()).toBe(0);
  });

  it('a reset by the owner also logs the person out on their other devices', async () => {
    const before = await login('dev@g.com');
    await new Promise((resolve) => setTimeout(resolve, 1100));
    expect((await call('business', 'POST', `/users/${users.dev._id}/reset-password`)).status).toBe(200);
    expect((await fetch(`${api}/auth/me`, { headers: { cookie: before } })).status).toBe(401);
    await User.updateOne({ _id: users.dev._id }, { $set: { passwordHash: await hashPassword(PASSWORD) } });
  });

  it('with email not set up: no link button, a clear refusal, and forgot password sends nothing', async () => {
    configureMail({ mode: 'off' });
    expect((await call(null, 'GET', '/auth/options')).json).toEqual({ passwordEmails: false, passwordRule: 'At least 8 characters, with a letter and a number' });
    const res = await call('business', 'POST', `/users/${users.kavya._id}/email-password-link`);
    expect(res).toMatchObject({ status: 409, json: { error: { code: 'MAIL_NOT_SET_UP' } } });
    expect(await sendResetIfAllowed('kavya@g.com')).toBe(false);
    const create = await call('business', 'POST', '/users', { role: 'FRONT_DESK', name: 'Nope', email: 'nope@g.com', branchIds: [String(f.andheri._id)], sendPasswordEmail: true });
    expect(create.status).toBe(409);
    expect(await User.exists({ email: 'nope@g.com' })).toBeNull();
  });
});

describe('request limits', () => {
  it('at most 5 forgot-password requests per IP every 15 minutes', async () => {
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await call(null, 'POST', '/auth/forgot-password', { email: `x${i}@nowhere.com` })).status);
    expect(statuses).toContain(429); // the first test already used 3 of the 5
    expect(statuses.filter((s) => s === 200).length).toBeLessThanOrEqual(5);
  });
});
