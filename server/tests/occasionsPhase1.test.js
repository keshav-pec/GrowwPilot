// Birthday & Anniversary Offers, Phase 1: the switch, birthday and anniversary month/day, home branch,
// messaging permission with history, the date import, and old dates of birth moved over.
// PRD AT-02 (customer with no dates), AT-34 (partial import), AT-36 (remove data, partly).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { ActivityLog, ConsentEvent, Customer, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { dayFitsMonth, describeOccasionDate, maskPhone } from '../src/config/occasions.js';
import { parseOccasionCells } from '../src/modules/occasions/import.service.js';
import { occasionDate } from '../src/modules/occasions/occasions.schemas.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
let server;
let api;
let f;
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
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, json, text };
}

const settingsPut = (who, body, version) => call(who, 'PUT', '/occasions/settings', { body, headers: version === undefined ? {} : { 'if-match': `"${version}"` } });
const consent = (who, customerId, body) => call(who, 'POST', `/occasions/customers/${customerId}/consents`, { body: { source: 'IN_SALON', ...body } });

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Bilal', email: 'bilal@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Layla', email: 'layla@d.com', passwordHash, allBranches: true },
  ]);
  // Fixture customers were made before home branches existed: the start-up migration gives them one
  await migrateOccasions({ log: () => {} });
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', branchOwner: 'bilal@g.com', desk: 'kavya@g.com', desert: 'layla@d.com' })) {
    cookies[who] = await login(email);
  }
});

afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('date rules', () => {
  it('the day must fit the month, and 29 February is allowed', () => {
    expect(dayFitsMonth(2, 29)).toBe(true);
    expect(dayFitsMonth(2, 30)).toBe(false);
    expect(dayFitsMonth(4, 31)).toBe(false);
    expect(dayFitsMonth(12, 31)).toBe(true);
    expect(dayFitsMonth(13, 1)).toBe(false);
    expect(occasionDate.safeParse({ month: 11, day: 31 }).success).toBe(false);
    expect(occasionDate.safeParse({ month: 2, day: 29 }).success).toBe(true);
    expect(occasionDate.safeParse({ month: 11 }).success).toBe(true);
    expect(occasionDate.safeParse(null).success).toBe(true);
  });

  it('describes a month without a day, and masks phones', () => {
    expect(describeOccasionDate({ month: 11, day: null })).toBe('November (day not provided)');
    expect(describeOccasionDate({ month: 2, day: 29 })).toBe('29 February');
    expect(maskPhone('9876543210')).toBe('98******10');
  });

  it('reads import cells: month names or numbers, day optional, never a day without a month', () => {
    expect(parseOccasionCells('Nov', '', 'Birthday')).toEqual({ date: { month: 11, day: null } });
    expect(parseOccasionCells('11', '5', 'Birthday')).toEqual({ date: { month: 11, day: 5 } });
    expect(parseOccasionCells('february', '29', 'Birthday')).toEqual({ date: { month: 2, day: 29 } });
    expect(parseOccasionCells('', '', 'Birthday')).toEqual({ date: undefined });
    expect(parseOccasionCells('', '5', 'Birthday').problem).toMatch(/without a month/);
    expect(parseOccasionCells('Novembr', '', 'Birthday').problem).toMatch(/isn’t a month/);
    expect(parseOccasionCells('4', '31', 'Anniversary').problem).toMatch(/isn’t a day in April/);
  });
});

describe('customer dates and home branch', () => {
  it('AT-02: a customer saved without dates works, and gets the branch they were added at', async () => {
    const res = await call('desk', 'POST', '/customers', { body: { name: 'Meera', phone: '9811111111' } });
    expect(res.status).toBe(201);
    const saved = await Customer.findById(res.json.customer._id).lean();
    expect(saved.occasions?.birthday ?? null).toBe(null);
    expect(saved.occasions?.anniversary ?? null).toBe(null);
    expect(String(saved.homeBranchId)).toBe(String(f.andheri._id));
    expect(saved.marketing.WHATSAPP.status).toBe('UNKNOWN');
  });

  it('saves a birthday month without a day and refuses a day that is not in the month', async () => {
    const ok = await call('desk', 'POST', '/customers', { body: { name: 'Nisha', phone: '9822222222', birthday: { month: 11 }, anniversary: { month: 2, day: 29 } } });
    expect(ok.status).toBe(201);
    const saved = await Customer.findById(ok.json.customer._id).lean();
    expect(saved.occasions.birthday).toMatchObject({ month: 11, day: null, source: 'STAFF' });
    expect(saved.occasions.anniversary).toMatchObject({ month: 2, day: 29 });
    expect(await ActivityLog.exists({ action: 'occasions.dates_changed', summary: /Nisha/ })).toBeTruthy();

    const bad = await call('desk', 'POST', '/customers', { body: { name: 'Bad Day', phone: '9833333333', birthday: { month: 11, day: 31 } } });
    expect(bad.status).toBe(400);
    expect(await Customer.exists({ phone: '9833333333' })).toBeNull();
  });

  it('changes and clears dates and the home branch through the dates route, with an activity row', async () => {
    const res = await call('desk', 'PUT', `/occasions/customers/${f.priya._id}/dates`, { body: { birthday: { month: 3, day: 14 } } });
    expect(res.status).toBe(200);
    expect(res.json.customer.occasions.birthday).toMatchObject({ month: 3, day: 14 });

    const cleared = await call('desk', 'PUT', `/occasions/customers/${f.priya._id}/dates`, { body: { birthday: null } });
    expect(cleared.json.customer.occasions.birthday).toBeNull();

    // The front desk can only choose one of their own branches
    const otherBranch = await call('desk', 'PUT', `/occasions/customers/${f.priya._id}/dates`, { body: { homeBranchId: String(f.bandra._id) } });
    expect(otherBranch.status).toBe(400);
    const moved = await call('business', 'PUT', `/occasions/customers/${f.priya._id}/dates`, { body: { homeBranchId: String(f.bandra._id) } });
    expect(moved.status).toBe(200);
    expect(String(moved.json.customer.homeBranchId)).toBe(String(f.bandra._id));
    const log = await ActivityLog.findOne({ action: 'occasions.dates_changed', summary: /home branch Bandra/ }).lean();
    expect(String(log.branchId)).toBe(String(f.bandra._id)); // the new branch's owners see it

    const profile = await call('business', 'GET', `/customers/${f.priya._id}`);
    expect(profile.json.customer.homeBranchName).toBe('Bandra');
  });
});

describe('the switch and settings', () => {
  it('the front desk cannot see or change settings (403, nothing changes)', async () => {
    expect((await call('desk', 'GET', '/occasions/settings')).status).toBe(403);
    const res = await settingsPut('desk', { enabled: true }, 0);
    expect(res.status).toBe(403);
    const org = await Organization.findById(f.ctxGlamour.orgId).lean();
    expect(org.occasionOffers.enabled).toBe(false);
  });

  it('branch owners can only look', async () => {
    const view = await call('branchOwner', 'GET', '/occasions/settings');
    expect(view.status).toBe(200);
    expect(view.json.can['occasions.manageSettings']).toBe(false);
    expect((await settingsPut('branchOwner', { enabled: true }, view.json.version)).status).toBe(403);
  });

  it('the business owner switches it on with the right version; a stale version is refused', async () => {
    const view = await call('business', 'GET', '/occasions/settings');
    expect(view.json.enabled).toBe(false);
    expect(view.json.counts).toMatchObject({ birthdayKnown: expect.any(Number), anniversaryKnown: expect.any(Number), canMessage: expect.any(Number) });

    expect((await settingsPut('business', { enabled: true })).status).toBe(400); // no If-Match
    expect((await settingsPut('business', { enabled: true }, view.json.version + 5)).status).toBe(409);

    const on = await settingsPut('business', { enabled: true }, view.json.version);
    expect(on.status).toBe(200);
    expect(on.json.enabled).toBe(true);
    expect(on.json.changedByName).toBe('Anita');
    expect(await ActivityLog.exists({ action: 'occasions.enabled' })).toBeTruthy();

    // The login session knows it's on
    const me = await call('desk', 'GET', '/auth/me');
    expect(me.json.user.org.occasionOffers.enabled).toBe(true);

    // The old version can't be used again
    expect((await settingsPut('business', { enabled: false }, view.json.version)).status).toBe(409);
  });

  it('changing the consent wording raises its version', async () => {
    const view = await call('business', 'GET', '/occasions/settings');
    expect(view.json.noticeVersion).toBe('v1');
    const noOptOut = await settingsPut('business', { consentText: 'I agree to receive offers from {salon_name} on {channel}.' }, view.json.version);
    expect(noOptOut.status).toBe(400);
    const res = await settingsPut('business', { consentText: 'Yes, {salon_name} may send me offers on {channel}. I can opt out whenever I like.' }, view.json.version);
    expect(res.json.noticeVersion).toBe('v2');
  });
});

describe('messaging permission', () => {
  it('recording needs the tick box and, from the front desk, "Customer asked for this"', async () => {
    const id = f.priya._id;
    expect((await consent('desk', id, { channel: 'WHATSAPP', status: 'OPTED_IN', customerAsked: true })).status).toBe(400);
    expect((await consent('desk', id, { channel: 'WHATSAPP', status: 'OPTED_IN', agreed: true })).status).toBe(400);
    expect((await call('desk', 'POST', `/occasions/customers/${id}/consents`, { body: { channel: 'WHATSAPP', status: 'OPTED_IN', agreed: true, customerAsked: true } })).status).toBe(400); // no source

    const ok = await consent('desk', id, { channel: 'WHATSAPP', status: 'OPTED_IN', agreed: true, customerAsked: true, note: 'Asked at the counter' });
    expect(ok.status).toBe(201);
    const saved = await Customer.findById(id).lean();
    expect(saved.marketing.WHATSAPP).toMatchObject({ status: 'OPTED_IN', source: 'IN_SALON', noticeVersion: 'v2', evidence: 'Asked at the counter' });

    expect((await consent('desk', id, { channel: 'WHATSAPP', status: 'OPTED_IN', agreed: true, customerAsked: true })).status).toBe(409);
    // Owners don't need "Customer asked for this"
    expect((await consent('business', id, { channel: 'SMS', status: 'OPTED_IN', agreed: true })).status).toBe(201);
    // Email needs an email address
    expect((await consent('business', id, { channel: 'EMAIL', status: 'OPTED_IN', agreed: true })).json.error.code).toBe('NO_EMAIL');
  });

  it('withdrawal works straight away, and the history lists every change and cannot be edited', async () => {
    const id = f.priya._id;
    const res = await consent('desk', id, { channel: 'WHATSAPP', status: 'OPTED_OUT', source: 'CUSTOMER_REQUEST' });
    expect(res.status).toBe(201);
    expect((await Customer.findById(id).lean()).marketing.WHATSAPP.status).toBe('OPTED_OUT');

    const tab = await call('desk', 'GET', `/occasions/customers/${id}/consents`);
    expect(tab.json.channels.find((c) => c.channel === 'WHATSAPP')).toMatchObject({ status: 'OPTED_OUT', changedByName: 'Kavya' });
    expect(tab.json.wording.WHATSAPP).toContain('Glamour may send me offers on WhatsApp');
    expect(tab.json.can.mustConfirmCustomerAsked).toBe(true);

    const history = await call('desk', 'GET', `/occasions/customers/${id}/consents/history`);
    expect(history.json.events.map((e) => `${e.channel}:${e.from}>${e.to}`)).toEqual(['WHATSAPP:OPTED_IN>OPTED_OUT', 'SMS:UNKNOWN>OPTED_IN', 'WHATSAPP:UNKNOWN>OPTED_IN']);
    const optIn = history.json.events.at(-1);
    expect(optIn).toMatchObject({ noticeVersion: 'v2', customerAsked: true, actorName: 'Kavya', actorRole: 'Front desk' });
    expect(optIn.wording).toContain('opt out');

    await expect(ConsentEvent.updateOne({ _id: optIn._id }, { $set: { to: 'UNKNOWN' } })).rejects.toThrow(/cannot be changed/);
  });
});

describe('date import', () => {
  it('only owners may download the template; it has customer IDs and masked phones', async () => {
    expect((await call('desk', 'GET', '/occasions/import/template')).status).toBe(403);
    const res = await call('business', 'GET', '/occasions/import/template');
    expect(res.status).toBe(200);
    expect(res.text).toContain('customer_id,name,phone,birthday_month');
    expect(res.text).toContain(String(f.priya._id));
    expect(res.text).toContain('98******10');
    expect(res.text).not.toContain('9876543210');
    expect(res.text).not.toContain('Fatima'); // another salon's customer
  });

  it('AT-34: a partial import saves good rows, lists bad ones, and never turns on permission', async () => {
    const meera = await Customer.findOne({ phone: '9811111111' }).lean();
    const nisha = await Customer.findOne({ phone: '9822222222' }).lean();
    const rows = [
      { customer_id: String(meera._id), name: 'Meera', birthday_month: 'November', birthday_day: '5', anniversary_month: '', anniversary_day: '' },
      { customer_id: String(nisha._id), birthday_month: '11', birthday_day: '' }, // same as saved: unchanged
      { customer_id: String(f.priya._id), birthday_month: 'Feb', birthday_day: '30' }, // not a day in February
      { customer_id: String(f.fatima._id), birthday_month: '1' }, // another salon's customer
      { customer_id: '9876543210', birthday_month: '1' }, // a phone, not an ID
      { customer_id: String(meera._id), birthday_month: '2' }, // same customer twice
    ];

    const check = await call('business', 'POST', '/occasions/import', { body: { rows, checkOnly: true }, key: null });
    expect(check.status).toBe(200);
    expect(check.json).toMatchObject({ total: 6, toSave: 1, unchanged: 1, saved: 0, checkOnly: true });
    expect(check.json.rejected.map((r) => r.row)).toEqual([4, 5, 6, 7]);
    expect((await Customer.findById(meera._id).lean()).occasions?.birthday ?? null).toBeNull(); // nothing saved yet

    const saved = await call('business', 'POST', '/occasions/import', { body: { rows, checkOnly: false } });
    expect(saved.json).toMatchObject({ saved: 1, toSave: 1, checkOnly: false });
    expect(saved.json.rejected[0].reason).toMatch(/isn’t a day in February/);
    const after = await Customer.findById(meera._id).lean();
    expect(after.occasions.birthday).toMatchObject({ month: 11, day: 5, source: 'IMPORTED' });
    expect(after.marketing.WHATSAPP.status).toBe('UNKNOWN');
    expect(await ActivityLog.exists({ action: 'occasions.dates_imported' })).toBeTruthy();
  });

  it('a branch owner can only import their own branches’ customers', async () => {
    const meera = await Customer.findOne({ phone: '9811111111' }).lean(); // Andheri
    const res = await call('branchOwner', 'POST', '/occasions/import', { body: { rows: [{ customer_id: String(meera._id), birthday_month: '1' }], checkOnly: true }, key: null });
    expect(res.json.rejected[0].reason).toMatch(/at your branches/);
  });
});

describe('remove occasion data (AT-36, partly)', () => {
  it('only the business owner; clears the dates and opts out of every channel with a reason', async () => {
    const nisha = await Customer.findOne({ phone: '9822222222' }).lean();
    await Customer.collection.updateOne({ _id: nisha._id }, { $set: { dob: new Date('1990-11-05T00:00:00Z') } });
    await consent('business', nisha._id, { channel: 'WHATSAPP', status: 'OPTED_IN', agreed: true });

    expect((await call('branchOwner', 'POST', `/occasions/customers/${nisha._id}/remove-data`, { body: { reason: 'Customer asked' } })).status).toBe(403);
    expect((await call('business', 'POST', `/occasions/customers/${nisha._id}/remove-data`, { body: {} })).status).toBe(400); // needs a reason

    const res = await call('business', 'POST', `/occasions/customers/${nisha._id}/remove-data`, { body: { reason: 'Customer asked us to delete it' } });
    expect(res.status).toBe(200);
    const after = await Customer.findById(nisha._id).lean();
    expect(after.occasions).toMatchObject({ birthday: null, anniversary: null });
    expect(after.dob).toBeUndefined();
    expect(['WHATSAPP', 'SMS', 'EMAIL'].map((c) => after.marketing[c].status)).toEqual(['OPTED_OUT', 'OPTED_OUT', 'OPTED_OUT']);
    expect(await ConsentEvent.countDocuments({ customerId: nisha._id, source: 'DATA_REMOVAL' })).toBe(3);

    // The start-up migration doesn't bring anything back
    await migrateOccasions({ log: () => {} });
    expect((await Customer.findById(nisha._id).lean()).occasions.birthday).toBeNull();
  });
});

describe('start-up migration', () => {
  it('copies old dates of birth (UTC), sets home branches and "not recorded", and running it twice changes nothing', async () => {
    const org = new mongoose.Types.ObjectId(f.ctxGlamour.orgId);
    const [leap, visitor, plain] = [new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId(), new mongoose.Types.ObjectId()];
    await Customer.collection.insertMany([
      { _id: leap, orgId: org, name: 'Old Leap', phone: '9700000001', dob: new Date('1992-02-29T00:00:00Z') },
      { _id: visitor, orgId: org, name: 'Old Visitor', phone: '9700000002', dob: new Date('1985-12-31T00:00:00Z') },
      { _id: plain, orgId: org, name: 'Old Plain', phone: '9700000003' },
    ]);
    // The visitor's latest appointment was at Bandra
    await mongoose.connection.collection('appointments').insertMany([
      { orgId: org, branchId: f.andheri._id, customerId: visitor, startAt: new Date('2026-01-01T10:00:00Z') },
      { orgId: org, branchId: f.bandra._id, customerId: visitor, startAt: new Date('2026-06-01T10:00:00Z') },
    ]);

    const first = await migrateOccasions({ log: () => {} });
    expect(first).toEqual({ birthdays: 2, homeBranches: 3, channels: 9 });
    const read = async () => Customer.find({ _id: { $in: [leap, visitor, plain] } }).sort({ phone: 1 }).lean();
    const once = await read();
    expect(once[0].occasions.birthday).toMatchObject({ month: 2, day: 29, source: 'MIGRATED' });
    expect(once[1].occasions.birthday).toMatchObject({ month: 12, day: 31 });
    expect(once[0].dob).toBeInstanceOf(Date); // the old date stays in the database
    expect(once[2].occasions?.birthday ?? null).toBeNull();
    expect(String(once[1].homeBranchId)).toBe(String(f.bandra._id));
    expect(String(once[0].homeBranchId)).toBe(String(f.andheri._id)); // first branch
    expect(once.every((c) => c.marketing.WHATSAPP.status === 'UNKNOWN' && c.marketing.EMAIL.status === 'UNKNOWN')).toBe(true);

    const second = await migrateOccasions({ log: () => {} });
    expect(second).toEqual({ birthdays: 0, homeBranches: 0, channels: 0 });
    expect(await read()).toEqual(once);
  });
});

describe('salon walls', () => {
  it('one salon cannot see or change another salon’s customers', async () => {
    const id = f.priya._id;
    expect((await call('desert', 'GET', `/occasions/customers/${id}/consents`)).status).toBe(404);
    expect((await call('desert', 'GET', `/occasions/customers/${id}/consents/history`)).status).toBe(404);
    expect((await call('desert', 'PUT', `/occasions/customers/${id}/dates`, { body: { birthday: { month: 1 } } })).status).toBe(404);
    expect((await consent('desert', id, { channel: 'SMS', status: 'OPTED_OUT' })).status).toBe(404);
    expect((await call('desert', 'POST', `/occasions/customers/${id}/remove-data`, { body: { reason: 'Not mine' } })).status).toBe(404);

    const settings = await call('desert', 'GET', '/occasions/settings');
    expect(settings.json.enabled).toBe(false); // Glamour's switch is Glamour's alone
    expect(settings.json.counts.customers).toBe(1);
  });
});
