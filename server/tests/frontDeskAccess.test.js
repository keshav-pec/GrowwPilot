// Who can reach front desk pay, tested through the real API (login cookie, roles, branch header).
// Front desk pay is for owners only: the business owner everywhere, a branch owner only at their branches,
// and front desk logins never (not even their own payslip, for now).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { createStaff } from '../src/modules/staff/staff.service.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import * as monthly from '../src/modules/payroll/monthlyPayroll.service.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
const now = DateTime.now().setZone('Asia/Kolkata');
const lastMonth = now.minus({ months: 1 }).toFormat('yyyy-MM');
const thisMonth = now.toFormat('yyyy-MM');
const today = now.toISODate();

let server;
let api; // base URL
let f;
let member; // Kavya, front desk member at Andheri, linked to her login
let item; // her payroll line in last month (locked)
const cookies = {};

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

async function call(who, method, path, { body, branch } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who], 'idempotency-key': `test-${Math.random().toString(36).slice(2)}` };
  if (branch) headers['x-branch-id'] = String(branch);
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const isJson = res.headers.get('content-type')?.includes('json');
  return { status: res.status, type: res.headers.get('content-type'), json: isJson ? await res.json() : null };
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const [anita, , kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
  ]);

  // Andheri: two stylists and Kavya on a salary; last month locked
  const owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  member = await createStaff(owner, { name: 'Kavya', role: 'Receptionist', kind: 'FRONT_DESK', branchId: String(f.andheri._id), userId: String(kavya._id) });
  const from = `${lastMonth}-01`;
  await payroll.createPlan(owner, member._id, { model: 'FIXED', monthlyBase: 1500000, effectiveFrom: from });
  await payroll.createPlan(owner, f.rahul._id, { model: 'FIXED', monthlyBase: 2000000, effectiveFrom: from });
  await payroll.createPlan(owner, f.neha._id, { model: 'FIXED', monthlyBase: 1800000, effectiveFrom: from });
  const run = await monthly.lockRun(owner, lastMonth);
  const { items } = await monthly.getRun({ ...owner }, lastMonth);
  item = items.find((i) => String(i.staffId) === String(member._id));
  expect(run.status).toBe('locked');

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  cookies.business = await login('anita@g.com');
  cookies.bandraOwner = await login('vikram@g.com');
  cookies.desk = await login('kavya@g.com');
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

const advance = () => ({ amount: 300000, givenOn: today, method: 'CASH', reason: 'Family wedding', monthlyRepayment: 100000, firstMonth: thisMonth });
const payment = () => ({ amount: 100000, method: 'UPI', paidOn: today });
const plan = () => ({ model: 'FIXED', monthlyBase: 2000000, effectiveFrom: `${now.plus({ months: 1 }).toFormat('yyyy-MM')}-01` });

describe('Business owner: full access to front desk pay', () => {
  it('sees them in pay setup and opens their pay', async () => {
    const list = await call('business', 'GET', '/payroll/staff');
    expect(list.json.rows.some((r) => r.staff._id === String(member._id))).toBe(true);
    const pay = await call('business', 'GET', `/payroll/staff/${member._id}`);
    expect(pay.status).toBe(200);
    expect(pay.json.staff.kind).toBe('FRONT_DESK');
  });

  it('sees them in the front desk section of monthly payroll', async () => {
    const month = await call('business', 'GET', `/payroll/runs/${lastMonth}`);
    expect(month.json.items.find((i) => i.staffId === String(member._id)).staffKind).toBe('FRONT_DESK');
    expect(month.json.run.totals.frontDesk.net).toBe(1500000);
  });

  it('records a payment, downloads the payslip and gives an advance', async () => {
    expect((await call('business', 'POST', `/payroll/items/${item._id}/payments`, { body: payment() })).status).toBe(201);
    const slip = await call('business', 'GET', `/payroll/items/${item._id}/payslip`);
    expect(slip.status).toBe(200);
    expect(slip.type).toContain('application/pdf');
    expect((await call('business', 'POST', `/payroll/staff/${member._id}/advances`, { body: advance() })).status).toBe(201);
    const advances = await call('business', 'GET', `/payroll/staff/${member._id}/advances`);
    expect(advances.json.advances).toHaveLength(1);
  });

  it('still cannot give them commission', async () => {
    const res = await call('business', 'POST', `/payroll/staff/${member._id}/plans`, {
      body: { model: 'FIXED_COMMISSION', monthlyBase: 1500000, commissionBps: 500, effectiveFrom: plan().effectiveFrom },
    });
    expect(res.json.error.code).toBe('FRONT_DESK_PAY');
  });
});

// [what we try, request] — every one must be refused
const blocked = {
  'Front desk login (same branch, linked to this member)': {
    who: 'desk',
    attempts: [
      ['open the pay', () => ['GET', `/payroll/staff/${member._id}`], 404],
      ['ask to change the pay', () => ['POST', '/payroll/requests', { body: { staffId: String(member._id), ...plan(), note: 'Raise please' } }], 404],
      ['change the pay', () => ['POST', `/payroll/staff/${member._id}/plans`, { body: plan() }], 403],
      ['open monthly payroll', () => ['GET', `/payroll/runs/${lastMonth}`], 403],
      ['download the payslip', () => ['GET', `/payroll/items/${item._id}/payslip`], 403],
      ['record a payment', () => ['POST', `/payroll/items/${item._id}/payments`, { body: payment() }], 403],
      ['see advances', () => ['GET', `/payroll/staff/${member._id}/advances`], 403],
      ['give an advance', () => ['POST', `/payroll/staff/${member._id}/advances`, { body: advance() }], 403],
      ['add a bonus', () => ['POST', '/payroll/adjustments', { body: { staffId: String(member._id), month: thisMonth, kind: 'bonus', amount: 1000, reason: 'Myself' } }], 403],
    ],
  },
  'Branch owner of another branch (Bandra)': {
    who: 'bandraOwner',
    attempts: [
      ['open the pay', () => ['GET', `/payroll/staff/${member._id}`], 404],
      ['change the pay', () => ['POST', `/payroll/staff/${member._id}/plans`, { body: plan() }], 404],
      ['download the payslip', () => ['GET', `/payroll/items/${item._id}/payslip`], 404],
      ['record a payment', () => ['POST', `/payroll/items/${item._id}/payments`, { body: payment() }], 404],
      ['see advances', () => ['GET', `/payroll/staff/${member._id}/advances`], 404],
      ['give an advance', () => ['POST', `/payroll/staff/${member._id}/advances`, { body: advance() }], 404],
      ['add a bonus', () => ['POST', '/payroll/adjustments', { body: { staffId: String(member._id), month: thisMonth, kind: 'bonus', amount: 1000, reason: 'Not my branch' } }], 404],
      ['open Andheri payroll with the branch header', () => ['GET', `/payroll/runs/${lastMonth}`, { branch: f.andheri._id }], 403],
    ],
  },
};

for (const [title, { who, attempts }] of Object.entries(blocked)) {
  describe(title, () => {
    for (const [what, request, expected] of attempts) {
      it(`can't ${what}`, async () => {
        const [method, path, options] = request();
        expect((await call(who, method, path, options)).status).toBe(expected);
      });
    }
  });
}

describe('Front desk login: pay setup list', () => {
  it('shows stylists only, never front desk members', async () => {
    const list = await call('desk', 'GET', '/payroll/staff');
    expect(list.status).toBe(200);
    expect(list.json.rows.some((r) => r.staff.kind === 'FRONT_DESK')).toBe(false);
    expect(list.json.rows.some((r) => r.staff._id === String(f.rahul._id))).toBe(true);
  });
});
