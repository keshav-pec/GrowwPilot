// Billing Phase 3: daily cash closing, dues with ageing, customer money history, reports (and that they add up),
// net sales on the dashboard, bill PDFs, share links and bill history.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import {
  ActivityLog, Appointment, BillingSettings, CashMovement, CashSession, CommissionEntry, Counter, CreditNote, CustomerAdvance, IdempotencyRecord, Invoice, Notification, Payment,
  PaymentAllocation, Refund, User,
} from '../src/models/index.js';
import { getInvoice, invoiceHistory, sharedInvoice, shareInvoice, openDraft } from '../src/modules/invoices/invoices.service.js';
import { recordPayments, takeAdvance } from '../src/modules/payments/payments.service.js';
import { createRefund } from '../src/modules/refunds/refunds.service.js';
import { addPettyCash, adjustCashDay, closeCashDay, currentCashDay, openCashDay } from '../src/modules/cash/cash.service.js';
import { customerMoney, duesOverview, runReport } from '../src/modules/billing/reports.service.js';
import { updateSettings } from '../src/modules/billing/settings.service.js';
import { getDashboard } from '../src/modules/dashboard/dashboard.service.js';
import { maskPhone, writeInvoicePdf } from '../src/modules/invoices/invoice.pdf.js';
import { toCsv } from '../src/utils/csv.js';
import { gstinCheckChar } from '../src/config/billing.js';
import { todayInZone } from '../src/utils/time.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

let f;
let owner;
let desk;
const today = () => todayInZone('Asia/Kolkata');

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [anita, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  desk = { ...f.ctxGlamour, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)], activeBranchId: String(f.andheri._id) };
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all(
    [Appointment, Invoice, Counter, Payment, PaymentAllocation, CustomerAdvance, Refund, CreditNote, BillingSettings, CommissionEntry, ActivityLog, Notification, IdempotencyRecord, CashSession].map((m) => m.deleteMany({}))
  );
  await CashMovement.collection.deleteMany({});
});

function completed(price = 100000) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price }],
    startAt: start, endAt: start, totalPrice: price, status: 'COMPLETED',
  });
}
const cash = (amount) => [{ method: 'CASH', amount }];
const registerForGst = () =>
  BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: '27AAKCG4821M1Z' + gstinCheckChar('27AAKCG4821M1Z'), stateCode: '27' }] });

// ===========================================================================
describe('Daily cash closing', () => {
  it('expected cash = float + cash in - cash out + petty cash; the gap needs a note; a closed day only takes adjustments', async () => {
    const day = await openCashDay(desk, { openingFloat: 200000 }, key());
    expect(day).toMatchObject({ status: 'OPEN', day: today(), expectedCash: 200000 });

    const bill = await checkout(desk, await completed(150000), { payments: cash(150000) });
    await checkout(desk, await completed(80000), { payments: [{ method: 'UPI', amount: 80000 }] }); // not cash: doesn't count
    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1 }], reason: 'Unhappy', method: 'CASH' }, key()); // ₹1,500 cash out
    await addPettyCash(desk, day._id, { kind: 'PETTY_OUT', amount: 20000, reason: 'Tea and milk' }, key());
    await addPettyCash(desk, day._id, { kind: 'PETTY_IN', amount: 5000, reason: 'Change from the bank' }, key());

    const live = (await currentCashDay(desk)).session;
    expect(live).toMatchObject({ cashIn: 150000, cashOut: 150000, pettyIn: 5000, pettyOut: 20000, expectedCash: 185000 });

    await expect(closeCashDay(desk, day._id, { countedCash: 184000 }, key())).rejects.toMatchObject({ code: 'REASON_REQUIRED', message: 'The drawer is ₹10.00 short. Add a note saying why.' });
    const closed = await closeCashDay(desk, day._id, { countedCash: 184000, note: 'Gave ₹10 change twice' }, key());
    expect(closed).toMatchObject({ status: 'CLOSED', expectedCash: 185000, countedCash: 184000, difference: -1000, closedByName: 'Kavya' });
    expect(await Notification.countDocuments({ userId: owner.userId })).toBeGreaterThan(0);

    await expect(addPettyCash(desk, day._id, { kind: 'PETTY_OUT', amount: 100, reason: 'Late tea' }, key())).rejects.toMatchObject({ code: 'CASH_DAY_CLOSED' });
    await expect(adjustCashDay(desk, day._id, { amount: 1000, reason: 'Found it' }, key())).rejects.toMatchObject({ status: 403 });
    const adjusted = await adjustCashDay(owner, day._id, { amount: -1000, reason: 'Change mistake confirmed' }, key());
    expect(adjusted).toMatchObject({ difference: -1000, adjustments: -1000, differenceAfterAdjustments: 0 });
    await expect(CashMovement.updateOne({}, { amount: 5 })).rejects.toThrow('cannot be changed');

    // Cash taken after closing shows up as a warning on the closed day
    await checkout(desk, await completed(30000), { payments: cash(30000) });
    expect((await currentCashDay(desk)).session.lateCash).toBe(30000);
    await expect(openCashDay(desk, { openingFloat: 0 }, key())).rejects.toMatchObject({ code: 'CASH_DAY_CLOSED' });
  });

  it("yesterday's open day must be closed first; tomorrow's float is suggested from the last count", async () => {
    await CashSession.create({ orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, day: '2026-01-01', openingFloat: 0 });
    await expect(openCashDay(desk, { openingFloat: 0 }, key())).rejects.toMatchObject({ code: 'CASH_DAY_OPEN', message: 'The cash day of 2026-01-01 is still open. Count the drawer and close it first.' });
    const old = await CashSession.findOne().lean();
    await closeCashDay(owner, old._id, { countedCash: 50000, note: 'Float left in' }, key());
    expect((await currentCashDay(desk)).suggestedFloat).toBe(50000);
  });

  it('the front desk can be stopped from closing', async () => {
    const day = await openCashDay(desk, { openingFloat: 0 }, key());
    await updateSettings(owner, { frontDesk: { closeCash: false } }, key());
    await expect(closeCashDay(desk, day._id, { countedCash: 0 }, key())).rejects.toMatchObject({ status: 403 });
    expect((await currentCashDay(desk)).permissions.close).toBe(false);
    expect((await closeCashDay(owner, day._id, { countedCash: 0 }, key())).status).toBe('CLOSED');
  });
});

// ===========================================================================
describe('Reports add up', () => {
  async function busyDay() {
    await registerForGst();
    const a = await checkout(desk, await completed(118000), { payments: [{ method: 'UPI', amount: 118000 }] });
    const b = await checkout(owner, await completed(59000), { billDiscount: { type: 'flat', value: 9000 }, payments: cash(30000) }); // ₹500 bill, ₹300 paid
    await takeAdvance(desk, { customerId: String(f.priya._id), method: 'CASH', amount: 20000 }, key());
    await createRefund(owner, { invoiceId: a._id, lines: [{ lineId: String(a.lines[0]._id), qty: 1 }], reason: 'Unhappy', method: 'UPI' }, key());
    return { a, b };
  }

  it('collections = money received - money handed back; sales match the bills; GST = bills - credit notes', async () => {
    await busyDay();
    const collections = await runReport(owner, 'collections', {});
    const payments = await Payment.find({ status: 'VALID' }).lean();
    const received = payments.filter((p) => p.kind === 'RECEIPT').reduce((s, p) => s + p.amount, 0);
    const back = payments.filter((p) => p.kind === 'REFUND').reduce((s, p) => s + p.amount, 0);
    expect(collections.totals).toMatchObject({ received, refunded: back, net: received - back, advances: 20000 });
    expect(collections.totals.net).toBe(118000 + 30000 + 20000 - 118000);

    const sales = await runReport(owner, 'sales', {});
    const bills = await Invoice.find({ status: 'ISSUED' }).lean();
    expect(sales.totals.billed).toBe(bills.reduce((s, b) => s + b.grandTotal, 0));
    expect(sales.totals.discounts).toBe(9000);
    expect(sales.totals.netSales).toBe(bills.reduce((s, b) => s + b.taxableTotal, 0) - 100000); // the ₹1,180 bill was refunded (₹1,000 + GST)

    const gst = await runReport(owner, 'gst', {});
    const notes = await CreditNote.find().lean();
    expect(gst.totals.netCgst).toBe(bills.reduce((s, b) => s + b.cgstTotal, 0) - notes.reduce((s, n) => s + n.cgstTotal, 0));
    expect(gst.rows.map((r) => r.rate)).toEqual(['18%']);

    const csv = toCsv(sales);
    expect(csv.split('\n')[0]).toBe('Day,Branch,Bills,Gross,Discounts,Sales before refunds,Refunded,Net sales,GST (net),Billed incl. GST');
    expect(csv).toContain('1770.00'); // ₹1,770 billed, written in rupees
  });

  it('the dashboard shows net sales without GST, and what was collected', async () => {
    await busyDay();
    const { kpis } = await getDashboard({ ...owner, activeBranchId: String(f.andheri._id) });
    const taxable = (await Invoice.find({ status: 'ISSUED' }).lean()).reduce((s, b) => s + b.taxableTotal, 0);
    expect(kpis.todayRevenue).toBe(taxable - 100000);
    expect(kpis.todayCollected).toBe(50000);
  });

  it('every report runs for owners; the front desk gets only today’s collections', async () => {
    await busyDay();
    for (const name of ['sales', 'gst', 'discounts', 'collections', 'dues', 'advances', 'retail', 'cash', 'staff']) {
      const report = await runReport(owner, name, { branches: 'all' });
      expect(report.columns.length).toBeGreaterThan(0);
    }
    expect((await runReport(owner, 'staff', {})).rows[0]).toMatchObject({ person: 'Rahul', services: 2, refunded: 100000 });
    await expect(runReport(desk, 'sales', {})).rejects.toMatchObject({ status: 403 });
    const mine = await runReport(desk, 'collections', { from: '2020-01-01', to: '2099-01-01', branches: 'all' });
    expect([mine.from, mine.to, mine.branches]).toEqual([today(), today(), ['Andheri']]);
  });
});

// ===========================================================================
describe('Dues and customer money', () => {
  it('ages unpaid bills: 0–30, 31–60, 61–90, over 90 days', async () => {
    const days = [5, 45, 75, 120];
    for (const age of days) {
      const bill = await checkout(desk, await completed(10000 * (age + 1)), { payments: [] });
      await Invoice.updateOne({ _id: bill._id }, { issuedAt: new Date(Date.now() - age * 86400000) });
    }
    const dues = await duesOverview(desk, {});
    expect(dues.buckets.map((b) => [b.label, b.bills])).toEqual([['0–30 days', 1], ['31–60 days', 1], ['61–90 days', 1], ['Over 90 days', 1]]);
    expect(dues.total).toBe(10000 * (6 + 46 + 76 + 121));
    expect(dues.customers).toEqual([expect.objectContaining({ customer: 'Priya', bills: 4, oldest: 120 })]);
    expect((await duesOverview(desk, { search: 'nobody' })).rows).toHaveLength(0);
  });

  it("a customer's bills, payments, refunds, advance and total due", async () => {
    const bill = await checkout(desk, await completed(100000), { payments: cash(40000) });
    await takeAdvance(desk, { customerId: String(f.priya._id), method: 'UPI', amount: 25000 }, key());
    const money = await customerMoney(desk, String(f.priya._id));
    expect(money).toMatchObject({ totalDue: 60000, totalBilled: 100000, advanceBalance: 25000 });
    expect(money.bills.map((b) => b.invoiceNumber)).toEqual([bill.invoiceNumber]);
    expect(money.payments.map((p) => [p.method, p.amount, p.source]).sort()).toEqual([['CASH', 40000, 'CHECKOUT'], ['UPI', 25000, 'ADVANCE']]);
  });
});

// ===========================================================================
describe('Bill PDF, share link and history', () => {
  it('history lists everything done to the bill, oldest first', async () => {
    const bill = await checkout(desk, await completed(), { payments: cash(30000) });
    await recordPayments(desk, { invoiceId: bill._id, payments: cash(70000) }, key());
    await createRefund(desk, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1 }], reason: 'Unhappy' }, key());
    const { items } = await invoiceHistory(desk, bill._id);
    expect(items.map((i) => i.action)).toEqual(['billing.bill_issued', 'billing.payment_recorded', 'billing.refund_requested']);
  });

  it('a share link opens only that bill, and only while it is valid', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    await expect(shareInvoice(desk, draft._id)).rejects.toMatchObject({ code: 'NOT_ISSUED' });
    const bill = await checkout(desk, await completed());
    const { token, days } = await shareInvoice(desk, bill._id);
    expect(days).toBe(30);
    expect((await sharedInvoice(token)).invoiceNumber).toBe(bill.invoiceNumber);
    await expect(sharedInvoice(`${token}x`)).rejects.toMatchObject({ status: 404 });
    expect(maskPhone('9876543210')).toBe('98XXXXXX10');
  });

  it('writes a real PDF', async () => {
    await registerForGst();
    const issued = await checkout(desk, await completed());
    const bill = await getInvoice(owner, issued._id);
    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => stream.on('end', resolve));
    writeInvoicePdf(stream, bill);
    await done;
    const pdf = Buffer.concat(chunks);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1500);
  });
});
