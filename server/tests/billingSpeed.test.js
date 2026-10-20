// PRD AC25: end-to-end speed at pilot volume, through the real API.
// Targets (PRD section 20): opening checkout under 2 seconds, a price quote under 500 ms.
// Pilot volume here: a year of a busy branch — 20,000 bills (with payments) for 2,000 customers.
// Each step is timed 5 times and the median is checked, so one slow moment doesn't fail the test.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { Appointment, Customer, Invoice, Payment, PaymentAllocation, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const BILLS = 20_000;
const CUSTOMERS = 2_000;
let server;
let api;
let f;
let cookie;
const times = {};

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
async function timed(name, request) {
  const start = performance.now();
  const res = await request();
  (times[name] ??= []).push(performance.now() - start);
  return res;
}
async function call(method, path, body) {
  const headers = { 'content-type': 'application/json', cookie, 'idempotency-key': `speed-${new mongoose.Types.ObjectId()}` };
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = new mongoose.Types.ObjectId(f.ctxGlamour.orgId);
  await User.create({ orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash: await hashPassword('Password@123'), branchIds: [f.andheri._id] });

  // A year of history, written straight into the database in bulk
  const customers = Array.from({ length: CUSTOMERS }, (_, i) => ({ _id: new mongoose.Types.ObjectId(), orgId: g, name: `Customer ${i}`, phone: `9${String(100000000 + i).padStart(9, '0')}` }));
  await Customer.collection.insertMany(customers);
  const yearAgo = Date.now() - 365 * 86400000;
  for (let batch = 0; batch < BILLS / 2000; batch++) {
    const bills = [];
    const payments = [];
    const allocations = [];
    for (let i = 0; i < 2000; i++) {
      const n = batch * 2000 + i;
      const at = new Date(yearAgo + (n / BILLS) * 364 * 86400000);
      const customer = customers[n % CUSTOMERS];
      const due = n % 10 === 0 ? 20000 : 0; // one bill in ten still owes ₹200
      const bill = {
        _id: new mongoose.Types.ObjectId(), orgId: g, branchId: f.andheri._id, customerId: customer._id, customerSnapshot: { name: customer.name, phone: customer.phone },
        status: 'ISSUED', settlementStatus: due ? 'PARTIALLY_PAID' : 'PAID', refundStatus: 'NONE', invoiceNumber: `SPD/${n}`, financialYear: '25-26',
        lines: [{ _id: new mongoose.Types.ObjectId(), kind: 'SERVICE', name: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', qty: 1, listUnitPrice: 100000, unitPrice: 100000, taxableAmount: 100000, lineTotal: 100000, discountType: 'flat', discountValue: 0, lineDiscount: 0, billDiscountShare: 0, comboDiscount: 0, cgst: 0, sgst: 0, taxRateBps: 0 }],
        subtotal: 100000, discountTotal: 0, manualDiscount: 0, comboDiscountTotal: 0, taxableTotal: 100000, taxTotal: 0, cgstTotal: 0, sgstTotal: 0, grandTotal: 100000,
        amountPaid: 100000 - due, balanceDue: due, creditedTotal: 0, refundedTotal: 0, issuedAt: at, paidAt: due ? undefined : at, version: 1, createdAt: at, updatedAt: at,
      };
      const payment = { _id: new mongoose.Types.ObjectId(), orgId: g, branchId: f.andheri._id, customerId: customer._id, kind: 'RECEIPT', method: n % 2 ? 'UPI' : 'CASH', amount: 100000 - due, receivedAt: at, source: 'CHECKOUT', status: 'VALID', verificationStatus: 'RECORDED' };
      bills.push(bill);
      payments.push(payment);
      allocations.push({ orgId: g, branchId: f.andheri._id, paymentId: payment._id, invoiceId: bill._id, amount: payment.amount, status: 'VALID', createdAt: at });
    }
    await Invoice.collection.insertMany(bills);
    await Payment.collection.insertMany(payments);
    await PaymentAllocation.collection.insertMany(allocations);
  }

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'kavya@g.com', password: 'Password@123' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
}, 300_000);
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('AC25: speed at pilot volume', () => {
  it(`opening checkout takes under 2 s and a price quote under 500 ms, with ${BILLS.toLocaleString('en-IN')} bills on file`, async () => {
    expect(await Invoice.countDocuments()).toBe(BILLS);
    for (let run = 0; run < 5; run++) {
      const start = new Date();
      const appt = await Appointment.create({
        orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
        items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price: 100000 }],
        startAt: start, endAt: start, totalPrice: 100000, status: 'COMPLETED',
      });
      // What the checkout screen loads: the appointment, then its draft bill
      const { invoice } = await timed('checkout', async () => {
        await call('GET', `/appointments/${appt._id}`);
        return call('POST', '/invoices', { appointmentId: String(appt._id) });
      });
      await timed('quote', () => call('POST', `/invoices/${invoice._id}/quote`, { billDiscount: { type: 'percent', value: 5 } }));
      await timed('issue', () => call('POST', `/invoices/${invoice._id}/issue`, { version: invoice.version, payments: [{ method: 'CASH', amount: 95000 }] }));
      await timed('bills list', () => call('GET', '/invoices?search=Customer 1&page=1'));
      await timed('dues', () => call('GET', '/billing/dues'));
    }
    const result = Object.fromEntries(Object.entries(times).map(([k, v]) => [k, Math.round(median(v))]));
    console.log('AC25 median times (ms):', result);
    expect(result.checkout).toBeLessThan(2000);
    expect(result.quote).toBeLessThan(500);
    expect(result.issue).toBeLessThan(2000);
    expect(result['bills list']).toBeLessThan(2000);
  }, 300_000);
});
