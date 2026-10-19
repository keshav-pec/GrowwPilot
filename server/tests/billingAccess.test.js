// Who can reach billing, tested through the real API (login cookie, roles, branch header, request keys).
// Bills and payments: owners and front desk, only at their branches. Billing settings: owners see them,
// only the business owner changes them. Inventory logins: no billing at all.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Appointment, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
let server;
let api;
let f;
const cookies = {};

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

// key: false sends no Idempotency-Key
async function call(who, method, path, { body, branch, key = true } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who] };
  if (key) headers['idempotency-key'] = `test-${Math.random().toString(36).slice(2)}`;
  if (branch) headers['x-branch-id'] = String(branch);
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: res.headers.get('content-type')?.includes('json') ? await res.json() : null };
}

function completedAt(branch, staff) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: branch._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: staff._id, staffName: staff.name, startAt: start, endAt: start, durationMinutes: 30, price: 50000 }],
    startAt: start, endAt: start, totalPrice: 50000, status: 'COMPLETED',
  });
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  await Organization.updateOne({ _id: g }, { $set: { 'addons.inventory.enabled': true } });
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'INVENTORY', name: 'Suresh', email: 'suresh@g.com', passwordHash, branchIds: [f.andheri._id] },
  ]);
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  cookies.business = await login('anita@g.com');
  cookies.bandraOwner = await login('vikram@g.com');
  cookies.desk = await login('kavya@g.com');
  cookies.stock = await login('suresh@g.com');
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('Front desk', () => {
  it('opens checkout, issues with a part payment and records the rest', async () => {
    const appt = await completedAt(f.andheri, f.rahul);
    const opened = await call('desk', 'POST', '/invoices', { body: { appointmentId: String(appt._id) }, key: false });
    expect(opened.status).toBe(201);
    const draft = opened.json.invoice;

    const quote = await call('desk', 'POST', `/invoices/${draft._id}/quote`, { body: { billDiscount: { type: 'flat', value: 5000 } }, key: false });
    expect(quote.json.invoice.grandTotal).toBe(45000);

    // A money change needs a request key
    expect((await call('desk', 'POST', `/invoices/${draft._id}/issue`, { body: { version: 0, payments: [] }, key: false })).status).toBe(400);
    const issued = await call('desk', 'POST', `/invoices/${draft._id}/issue`, { body: { version: 0, billDiscount: { type: 'flat', value: 5000 }, payments: [{ method: 'UPI', amount: 20000 }] } });
    expect(issued.status).toBe(200);
    expect(issued.json.invoice).toMatchObject({ status: 'ISSUED', settlementStatus: 'PARTIALLY_PAID', balanceDue: 25000 });

    const rest = await call('desk', 'POST', '/payments', { body: { invoiceId: draft._id, payments: [{ method: 'OTHER', amount: 25000, reference: 'Voucher 12' }] } });
    expect(rest.status).toBe(201);
    expect(rest.json.invoice.settlementStatus).toBe('PAID');

    const list = await call('desk', 'GET', '/invoices?status=PAID', { key: false });
    expect(list.json.rows.map((r) => r._id)).toContain(draft._id);
  });

  it('cannot approve discounts, see or change billing settings, or reach another branch', async () => {
    const appt = await completedAt(f.bandra, f.arjun);
    expect((await call('desk', 'POST', '/invoices', { body: { appointmentId: String(appt._id) }, key: false })).status).toBe(404);
    expect((await call('desk', 'GET', '/billing/settings')).status).toBe(403);
    expect((await call('desk', 'PATCH', '/billing/settings', { body: { gstRegistered: false } })).status).toBe(403);
    expect((await call('desk', 'GET', '/invoices?branchId=all', { key: false })).json.rows.every((r) => r.branchId._id === String(f.andheri._id))).toBe(true);

    const mine = (await call('desk', 'POST', '/invoices', { body: { appointmentId: String((await completedAt(f.andheri, f.neha))._id) }, key: false })).json.invoice;
    expect((await call('desk', 'POST', `/invoices/${mine._id}/approve`, { body: { version: 0 } })).status).toBe(403);
  });

  it('bad money input is refused before it reaches the bill', async () => {
    const draft = (await call('desk', 'POST', '/invoices', { body: { appointmentId: String((await completedAt(f.andheri, f.rahul))._id) }, key: false })).json.invoice;
    const bad = [
      { version: 0, payments: [{ method: 'CASH', amount: -100 }] },
      { version: 0, payments: [{ method: 'CHEQUE', amount: 100 }] },
      { version: 0, billDiscount: { type: 'flat', value: 10.5 } },
      { version: 0, billDiscount: { type: 'percent', value: 12.345 } },
    ];
    for (const body of bad) expect((await call('desk', 'POST', `/invoices/${draft._id}/issue`, { body })).status).toBe(400);
  });
});

describe('Phase 2 actions', () => {
  it('front desk: can take advances and ask for refunds, but not void, reverse or approve', async () => {
    const appt = await completedAt(f.andheri, f.rahul);
    const draft = (await call('desk', 'POST', '/invoices', { body: { appointmentId: String(appt._id) }, key: false })).json.invoice;
    const bill = (await call('desk', 'POST', `/invoices/${draft._id}/issue`, { body: { version: 0, payments: [{ method: 'CASH', amount: 50000 }] } })).json.invoice;

    expect((await call('desk', 'POST', `/invoices/${bill._id}/void`, { body: { reason: 'Mistake' } })).status).toBe(403);
    expect((await call('desk', 'POST', `/payments/${bill.payments[0]._id}/reverse`, { body: { reason: 'Mistake' } })).status).toBe(403);
    const asked = await call('desk', 'POST', '/refunds', { body: { invoiceId: bill._id, lines: [{ lineId: bill.lines[0]._id, qty: 1 }], reason: 'Unhappy' } });
    expect(asked.status).toBe(201);
    expect(asked.json.refund.status).toBe('REQUESTED');
    expect((await call('desk', 'POST', `/refunds/${asked.json.refund._id}/approve`, { body: {} })).status).toBe(403);
    expect((await call('business', 'POST', `/refunds/${asked.json.refund._id}/approve`, { body: {} })).json.refund.status).toBe('DONE');

    const advance = await call('desk', 'POST', '/advances', { body: { customerId: String(f.priya._id), method: 'UPI', amount: 20000 } });
    expect(advance.status).toBe(201);
    expect((await call('desk', 'GET', `/advances?customerId=${f.priya._id}`, { key: false })).json.balance).toBe(20000);
  });

  it('a refund request without a request key is refused', async () => {
    expect((await call('desk', 'POST', '/refunds', { body: {}, key: false })).status).toBe(400);
  });
});

describe('Owners', () => {
  it('the business owner changes billing settings; a branch owner only sees them', async () => {
    const saved = await call('business', 'PATCH', '/billing/settings', { body: { frontDeskDiscountLimitBps: 1500 } });
    expect(saved.status).toBe(200);
    expect(saved.json.frontDeskDiscountLimitBps).toBe(1500);

    const seen = await call('bandraOwner', 'GET', '/billing/settings');
    expect(seen.json).toMatchObject({ canEdit: false, frontDeskDiscountLimitBps: 1500 });
    expect((await call('bandraOwner', 'PATCH', '/billing/settings', { body: { frontDeskDiscountLimitBps: 9000 } })).status).toBe(403);
  });
});

describe('Inventory login', () => {
  it('has no billing at all', async () => {
    for (const [method, path] of [['GET', '/invoices'], ['POST', '/invoices'], ['POST', '/payments'], ['GET', '/billing/settings'], ['POST', '/refunds'], ['GET', '/advances'], ['POST', '/invoices/sale']]) {
      expect((await call('stock', method, path, { body: method === 'GET' ? undefined : {} })).status).toBe(403);
    }
  });
});
