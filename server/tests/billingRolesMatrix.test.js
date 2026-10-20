// Billing: every billing action tried by every role, through the real API (like inventoryRolesMatrix.test.js).
//   business  = business owner (every branch)       bandra = branch owner of Bandra only (the data is at Andheri)
//   desk      = front desk at Andheri                stock  = inventory login at Andheri
// Expected: 2xx allowed; 403 refused by role; 404 = another branch's record (it "doesn't exist" for them).
// A 400/404/409 for an allowed role means the permission check passed and a business rule stopped it on purpose.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Appointment, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
const ROLES = ['business', 'bandra', 'desk', 'stock'];
let server;
let api;
let f;
const cookies = {};
const ids = {};
const fake = String(new mongoose.Types.ObjectId());

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie')?.split(';')[0];
}
async function call(who, method, path, body) {
  const headers = { 'content-type': 'application/json', 'idempotency-key': `test-${new mongoose.Types.ObjectId()}` };
  if (who) headers.cookie = cookies[who];
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, json: type.includes('json') ? await res.json() : null };
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
  for (const [who, email] of Object.entries({ business: 'anita@g.com', bandra: 'vikram@g.com', desk: 'kavya@g.com', stock: 'suresh@g.com' })) cookies[who] = await login(email);

  // An Andheri bill, part paid, to aim at
  const start = new Date();
  const appt = await Appointment.create({
    orgId: g, branchId: f.andheri._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price: 50000 }],
    startAt: start, endAt: start, totalPrice: 50000, status: 'COMPLETED',
  });
  const draft = (await call('desk', 'POST', '/invoices', { appointmentId: String(appt._id) })).json.invoice;
  const bill = (await call('desk', 'POST', `/invoices/${draft._id}/issue`, { version: 0, payments: [{ method: 'CASH', amount: 20000 }] })).json.invoice;
  ids.bill = bill._id;
  ids.line = bill.lines[0]._id;
  ids.payment = bill.payments[0]._id;
  ids.customer = String(f.priya._id);
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

const matrix = [
  ['list bills', () => ['GET', '/invoices'], { business: 200, bandra: 200, desk: 200, stock: 403 }],
  ['open a bill', () => ['GET', `/invoices/${ids.bill}`], { business: 200, bandra: 404, desk: 200, stock: 403 }],
  ['download the PDF', () => ['GET', `/invoices/${ids.bill}/pdf`], { business: 200, bandra: 404, desk: 200, stock: 403 }],
  ['see the bill history', () => ['GET', `/invoices/${ids.bill}/history`], { business: 200, bandra: 404, desk: 200, stock: 403 }],
  ['make a share link', () => ['POST', `/invoices/${ids.bill}/share`], { business: 200, bandra: 404, desk: 200, stock: 403 }],
  ['void a bill with money on it', () => ['POST', `/invoices/${ids.bill}/void`, { reason: 'Testing' }], { business: 409, bandra: 404, desk: 403, stock: 403 }],
  ['reverse a payment (unknown)', () => ['POST', `/payments/${fake}/reverse`, { reason: 'Testing' }], { business: 404, bandra: 404, desk: 403, stock: 403 }],
  ['preview a refund', () => ['POST', '/refunds/quote', { invoiceId: ids.bill, lines: [{ lineId: ids.line, qty: 1 }] }], { business: 200, bandra: 404, desk: 200, stock: 403 }],
  ['approve a refund (unknown)', () => ['POST', `/refunds/${fake}/approve`, {}], { business: 404, bandra: 404, desk: 403, stock: 403 }],
  ['see billing settings', () => ['GET', '/billing/settings'], { business: 200, bandra: 200, desk: 403, stock: 403 }],
  ['change billing settings', () => ['PATCH', '/billing/settings', { frontDeskDiscountLimitBps: 1000 }], { business: 200, bandra: 403, desk: 403, stock: 403 }],
  ['sales report', () => ['GET', '/billing/reports/sales?branches=all'], { business: 200, bandra: 200, desk: 403, stock: 403 }],
  ['GST report', () => ['GET', '/billing/reports/gst'], { business: 200, bandra: 200, desk: 403, stock: 403 }],
  ["today's collections", () => ['GET', '/billing/reports/collections'], { business: 200, bandra: 200, desk: 200, stock: 403 }],
  ['dues page', () => ['GET', '/billing/dues'], { business: 200, bandra: 200, desk: 200, stock: 403 }],
  ['cash day', () => ['GET', '/cash-sessions/current'], { business: 200, bandra: 200, desk: 200, stock: 403 }],
  ['adjust a cash day (unknown)', () => ['POST', `/cash-sessions/${fake}/adjustments`, { amount: 100, reason: 'Testing' }], { business: 404, bandra: 404, desk: 403, stock: 403 }],
  ["a customer's advances", () => ['GET', `/advances?customerId=${ids.customer}`], { business: 200, bandra: 200, desk: 200, stock: 403 }],
  ["a customer's money", () => ['GET', `/customers/${ids.customer}/money`], { business: 200, bandra: 200, desk: 200, stock: 403 }],
];

describe('Who can do what in billing', () => {
  for (const [what, request, expected] of matrix) {
    it(what, async () => {
      const [method, path, body] = request();
      const got = {};
      for (const who of ROLES) got[who] = (await call(who, method, path, body)).status;
      expect(got).toEqual(expected);
    });
  }

  it("a branch owner sees only their branch's money", async () => {
    const dues = await call('bandra', 'GET', '/billing/dues?branches=all');
    expect(dues.json.rows).toHaveLength(0);
    const money = await call('bandra', 'GET', `/customers/${ids.customer}/money`);
    expect(money.json).toMatchObject({ totalDue: 0, bills: [] });
    expect((await call('business', 'GET', `/customers/${ids.customer}/money`)).json.totalDue).toBe(30000);
  });

  it('CSV downloads are real CSV files', async () => {
    const res = await fetch(`${api}/billing/reports/collections?format=csv`, { headers: { cookie: cookies.desk } });
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect((await res.text()).replace(/^﻿/, '').split('\n')[0]).toBe('Day,Branch,Method,Payments,Received,Of which advances,Handed back,Net collected');
  });
});

describe('Shared bill links (no login)', () => {
  it('open the PDF with a valid link, and nothing with a wrong one', async () => {
    const { token } = (await call('desk', 'POST', `/invoices/${ids.bill}/share`)).json;
    const ok = await fetch(`${api}/public/bills/${token}.pdf`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-type')).toBe('application/pdf');
    expect((await call(null, 'GET', `/public/bills/${token.slice(0, -2)}xx.pdf`)).status).toBe(404);
    expect((await call(null, 'GET', `/invoices/${ids.bill}/pdf`)).status).toBe(401);
  });
});
