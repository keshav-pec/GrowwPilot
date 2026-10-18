import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  ActivityLog, Appointment, BillingSettings, CommissionEntry, Counter, IdempotencyRecord, Invoice, Notification, Payment, PaymentAllocation, PayPlan, Service, User,
} from '../src/models/index.js';
import {
  approveDiscount, getInvoice, issueInvoice, listInvoices, openDraft, quoteDraft, rejectDiscount, requestApproval, saveDraft,
} from '../src/modules/invoices/invoices.service.js';
import { recordPayments } from '../src/modules/payments/payments.service.js';
import { getSettingsForScreen, updateSettings } from '../src/modules/billing/settings.service.js';
import { computeBill, discountLimit, lineTax, roundHalfUp } from '../src/modules/billing/tax.rules.js';
import { financialYear, gstinCheckChar, isValidGstin } from '../src/config/billing.js';
import { migrateBilling } from '../src/scripts/migrate-billing-v2.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { getDashboard } from '../src/modules/dashboard/dashboard.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

let f;
let owner; // business owner, every branch
let bandraOwner; // branch owner, Bandra only
let desk; // front desk at Andheri
const FY = financialYear(new Date(), 'Asia/Kolkata');
const GSTIN = (first14) => first14 + gstinCheckChar(first14);
const ANDHERI_GSTIN = GSTIN('27AAKCG4821M1Z');

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [anita, vikram, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  bandraOwner = { ...f.ctxGlamour, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
  desk = { ...f.ctxGlamour, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)], activeBranchId: String(f.andheri._id) };
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all(
    [Appointment, Invoice, Counter, Payment, PaymentAllocation, BillingSettings, CommissionEntry, PayPlan, ActivityLog, Notification, IdempotencyRecord].map((m) => m.deleteMany({}))
  );
  await Service.updateMany({}, { $set: { taxRateBps: null, sacCode: '' } });
});

// A finished appointment at Andheri. lines: [[service, stylist, price in paise]]
function completed(lines = [[f.haircut, f.rahul, 153000]], { status = 'COMPLETED', totalPrice, branch = f.andheri, comboId } = {}) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: branch._id, customerId: f.priya._id,
    customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: lines.map(([service, stylist, price]) => ({
      serviceId: service._id, serviceName: service.name, staffId: stylist._id, staffName: stylist.name, startAt: start, endAt: start, durationMinutes: 30, price,
    })),
    startAt: start, endAt: start, totalPrice: totalPrice ?? lines.reduce((sum, l) => sum + l[2], 0), status, comboId,
  });
}

// Glamour as a GST-registered salon (Andheri has a GSTIN)
async function registerForGst(extra = {}) {
  await BillingSettings.create({
    orgId: f.ctxGlamour.orgId, legalName: 'Glamour Studio Pvt Ltd', gstRegistered: true,
    branches: [{ branchId: f.andheri._id, gstin: ANDHERI_GSTIN, stateCode: '27' }], ...extra,
  });
}

const cash = (amount) => [{ method: 'CASH', amount }];

// ===========================================================================
describe('Bill maths (tax.rules)', () => {
  const unregistered = { gstRegistered: false, pricesIncludeTax: true };
  const inclusive = { gstRegistered: true, pricesIncludeTax: true };
  const exclusive = { gstRegistered: true, pricesIncludeTax: false };

  it('takes GST out of a price that includes it: ₹1,180 at 18% = ₹1,000 + ₹90 CGST + ₹90 SGST', () => {
    expect(lineTax(118000, 1800, inclusive)).toEqual({ taxableAmount: 100000, cgst: 9000, sgst: 9000, lineTotal: 118000 });
  });

  it('adds GST on top when prices are without it: ₹1,000 at 18% = ₹1,180', () => {
    expect(lineTax(100000, 1800, exclusive)).toEqual({ taxableAmount: 100000, cgst: 9000, sgst: 9000, lineTotal: 118000 });
  });

  it('charges no tax when the salon is not GST registered', () => {
    expect(lineTax(118000, 1800, unregistered)).toEqual({ taxableAmount: 118000, cgst: 0, sgst: 0, lineTotal: 118000 });
  });

  it('rounds each line half up, and CGST always equals SGST', () => {
    expect(roundHalfUp(5, 2)).toBe(3);
    expect(roundHalfUp(4, 2)).toBe(2);
    // ₹500 incl. 18%: each half is 38.1356 -> ₹38.14, and the line still adds up to ₹500
    expect(lineTax(50000, 1800, inclusive)).toEqual({ taxableAmount: 42372, cgst: 3814, sgst: 3814, lineTotal: 50000 });
  });

  it('shares a bill discount over the lines to the paisa', () => {
    const bill = computeBill(
      [{ unitPrice: 50000, taxRateBps: 0 }, { unitPrice: 20000, taxRateBps: 0 }],
      { type: 'flat', value: 10000 },
      unregistered
    );
    expect(bill.lines.map((l) => l.billDiscountShare)).toEqual([7143, 2857]);
    expect(bill.totals).toMatchObject({ subtotal: 70000, manualDiscount: 10000, grandTotal: 60000 });
  });

  it('applies line discounts first, then the bill discount, then GST per line', () => {
    const bill = computeBill(
      [
        { unitPrice: 118000, discount: { type: 'percent', value: 12.5 }, taxRateBps: 1800 }, // ₹1,180 - 12.5% = ₹1,032.50
        { unitPrice: 59000, discount: { type: 'flat', value: 9000 }, taxRateBps: 500 }, // ₹590 - ₹90 = ₹500
      ],
      { type: 'flat', value: 13250 },
      inclusive
    );
    expect(bill.lines.map((l) => l.lineDiscount)).toEqual([14750, 9000]);
    expect(bill.totals.grandTotal).toBe(118000 + 59000 - 14750 - 9000 - 13250);
    expect(bill.taxSummary.map((r) => r.rateBps)).toEqual([500, 1800]);
    expect(bill.totals.taxTotal).toBe(bill.totals.cgstTotal * 2);
    expect(bill.totals.taxableTotal + bill.totals.taxTotal).toBe(bill.totals.grandTotal);
  });

  it('refuses a discount bigger than the line or the bill', () => {
    expect(() => computeBill([{ unitPrice: 50000, discount: { type: 'flat', value: 60000 }, name: 'Haircut' }], null, unregistered)).toThrow("can't be more than");
    expect(() => computeBill([{ unitPrice: 50000 }], { type: 'percent', value: 120 }, unregistered)).toThrow('at most 100%');
  });

  it('works out the front desk limit on the bill after combo prices', () => {
    expect(discountLimit({ subtotal: 70000, comboDiscountTotal: 10000 }, 1000)).toBe(6000);
  });

  it('checks GSTINs, including the check character', () => {
    expect(isValidGstin(ANDHERI_GSTIN)).toBe(true);
    expect(isValidGstin(ANDHERI_GSTIN.slice(0, 14) + (ANDHERI_GSTIN[14] === 'A' ? 'B' : 'A'))).toBe(false);
    expect(isValidGstin('99AAKCG4821M1Z5')).toBe(false); // no such state
  });
});

// ===========================================================================
describe('Draft bills', () => {
  it('opening checkout makes one draft with no number, from the appointment', async () => {
    const appt = await completed();
    const draft = await openDraft(desk, { appointmentId: appt._id });
    expect(draft).toMatchObject({ status: 'DRAFT', grandTotal: 153000, balanceDue: 153000, version: 0 });
    expect(draft.invoiceNumber).toBeUndefined();
    expect(draft.lines[0]).toMatchObject({ kind: 'SERVICE', name: 'Haircut', staffName: 'Rahul', unitPrice: 153000, taxableAmount: 153000 });

    // Opening it again, or from two desks at once, gives the same draft
    const again = await Promise.all([openDraft(desk, { appointmentId: appt._id }), openDraft(owner, { appointmentId: appt._id })]);
    expect(again.map((d) => String(d._id))).toEqual([String(draft._id), String(draft._id)]);
    expect(await Invoice.countDocuments()).toBe(1);
    expect((await Appointment.findById(appt._id)).invoiceId).toBeUndefined(); // only issuing bills it
  });

  it('only completed appointments can be checked out', async () => {
    const appt = await completed(undefined, { status: 'IN_SERVICE' });
    await expect(openDraft(desk, { appointmentId: appt._id })).rejects.toMatchObject({ code: 'NOT_COMPLETED' });
  });

  it('shares a combo price over its services', async () => {
    const appt = await completed([[f.haircut, f.rahul, 50000], [f.beardTrim, f.neha, 20000]], { totalPrice: 60000, comboId: f.combo._id });
    const draft = await openDraft(desk, { appointmentId: appt._id });
    expect(draft.lines.map((l) => l.comboDiscount)).toEqual([7143, 2857]);
    expect(draft).toMatchObject({ subtotal: 70000, comboDiscountTotal: 10000, manualDiscount: 0, grandTotal: 60000 });
  });

  it('saves discounts, and refuses an edit made on an old copy', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const saved = await saveDraft(desk, draft._id, { version: 0, lines: [{ lineId: String(draft.lines[0]._id), discount: { type: 'flat', value: 3000 } }] });
    expect(saved).toMatchObject({ version: 1, manualDiscount: 3000, grandTotal: 150000 });
    await expect(saveDraft(desk, draft._id, { version: 0, billDiscount: { type: 'flat', value: 100 } })).rejects.toMatchObject({ code: 'STALE_VERSION' });
  });

  it('previews prices without saving anything', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const quote = await quoteDraft(desk, draft._id, { billDiscount: { type: 'percent', value: 10 } });
    expect(quote.grandTotal).toBe(137700);
    expect((await Invoice.findById(draft._id)).grandTotal).toBe(153000);
  });

  it('only owners change a price, and only with a reason', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const lineId = String(draft.lines[0]._id);
    await expect(saveDraft(desk, draft._id, { version: 0, lines: [{ lineId, unitPrice: 100000, priceChangeReason: 'Regular' }] })).rejects.toMatchObject({ status: 403 });
    await expect(saveDraft(owner, draft._id, { version: 0, lines: [{ lineId, unitPrice: 100000 }] })).rejects.toMatchObject({ code: 'REASON_REQUIRED' });

    const saved = await saveDraft(owner, draft._id, { version: 0, lines: [{ lineId, unitPrice: 100000, priceChangeReason: 'Short hair' }] });
    expect(saved.lines[0]).toMatchObject({ listUnitPrice: 153000, unitPrice: 100000, priceChangeReason: 'Short hair' });
    expect((await ActivityLog.findOne({ action: 'billing.price_changed' })).summary).toBe("Changed the price of Haircut on Priya's bill from ₹1,530.00 to ₹1,000.00 (Short hair)");
  });
});

// ===========================================================================
describe('Issue & pay', () => {
  it('issues with a split payment: number, locked, appointment billed, payments saved', async () => {
    const appt = await completed();
    const bill = await checkout(desk, appt, { payments: [{ method: 'CARD', amount: 100000 }, { method: 'UPI', amount: 50000, reference: 'UPI123' }, { method: 'CASH', amount: 3000 }] });
    expect(bill).toMatchObject({ status: 'ISSUED', settlementStatus: 'PAID', invoiceNumber: `AND/${FY}/00001`, financialYear: FY, amountPaid: 153000, balanceDue: 0 });
    expect(bill.invoiceNumber.length).toBeLessThanOrEqual(16);
    expect(bill.payments.map((p) => [p.method, p.amount])).toEqual([['CARD', 100000], ['UPI', 50000], ['CASH', 3000]]);
    expect(await PaymentAllocation.countDocuments({ invoiceId: bill._id })).toBe(3);
    expect(String((await Appointment.findById(appt._id)).invoiceId)).toBe(String(bill._id));
    expect((await ActivityLog.findOne({ action: 'billing.bill_issued' })).summary).toBe(`Issued bill AND/${FY}/00001 for Priya: ₹1,530.00 (paid in full)`);

    // Locked once issued
    await expect(saveDraft(owner, bill._id, { version: bill.version, billDiscount: { type: 'flat', value: 100 } })).rejects.toMatchObject({ code: 'ALREADY_ISSUED' });
  });

  it('takes part of the money now and the rest later', async () => {
    const bill = await checkout(desk, await completed(), { payments: cash(50000) });
    expect(bill).toMatchObject({ settlementStatus: 'PARTIALLY_PAID', amountPaid: 50000, balanceDue: 103000 });

    await expect(recordPayments(desk, { invoiceId: bill._id, payments: cash(110000) }, key())).rejects.toMatchObject({ code: 'OVERPAID', message: 'Only ₹1,030.00 is due on this bill' });
    const paid = await recordPayments(desk, { invoiceId: bill._id, payments: [{ method: 'UPI', amount: 103000 }] }, key());
    expect(paid).toMatchObject({ settlementStatus: 'PAID', amountPaid: 153000, balanceDue: 0 });
    expect(paid.payments.map((p) => p.source)).toEqual(['CHECKOUT', 'LATER']);
    await expect(recordPayments(desk, { invoiceId: bill._id, payments: cash(100) }, key())).rejects.toMatchObject({ message: 'This bill is already fully paid' });
  });

  it('can be issued with nothing paid yet ("pay later")', async () => {
    const bill = await checkout(desk, await completed(), { payments: [] });
    expect(bill).toMatchObject({ status: 'ISSUED', settlementStatus: 'UNPAID', balanceDue: 153000 });
  });

  it('refuses paying more than the bill, and keeps it a draft without using a number', async () => {
    const appt = await completed();
    await expect(checkout(desk, appt, { payments: cash(160000) })).rejects.toMatchObject({ code: 'OVERPAID', message: 'Payments are ₹70.00 more than the bill (₹1,530.00)' });
    expect((await Invoice.findOne({ appointmentId: appt._id })).status).toBe('DRAFT');
    const next = await checkout(desk, await completed());
    expect(next.invoiceNumber).toBe(`AND/${FY}/00001`);
  });

  it('a double click (same request key) issues once', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const k = key();
    const input = { version: 0, payments: cash(153000) };
    const [a, b] = await Promise.all([issueInvoice(desk, draft._id, input, k), issueInvoice(desk, draft._id, input, k)]);
    expect(a.invoiceNumber).toBe(b.invoiceNumber);
    expect(await Payment.countDocuments()).toBe(1);
  });

  it('two desks paying the rest at the same moment can never over-pay', async () => {
    const bill = await checkout(desk, await completed(), { payments: cash(53000) });
    const results = await Promise.allSettled([
      recordPayments(desk, { invoiceId: bill._id, payments: cash(100000) }, key()),
      recordPayments(owner, { invoiceId: bill._id, payments: [{ method: 'UPI', amount: 100000 }] }, key()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const saved = await Invoice.findById(bill._id);
    expect([saved.amountPaid, saved.balanceDue]).toEqual([153000, 0]);
    expect(await Payment.countDocuments()).toBe(2);
  });

  it('numbers count up per branch and financial year', async () => {
    const one = await checkout(desk, await completed());
    const two = await checkout(desk, await completed());
    const bandra = await checkout(owner, await completed([[f.facial, f.arjun, 120000]], { branch: f.bandra }));
    expect([one.invoiceNumber, two.invoiceNumber, bandra.invoiceNumber]).toEqual([`AND/${FY}/00001`, `AND/${FY}/00002`, `BAN/${FY}/00001`]);
  });

  it('a 100% discount bill is paid as soon as it is issued', async () => {
    const bill = await checkout(owner, await completed(), { billDiscount: { type: 'percent', value: 100 } });
    expect(bill).toMatchObject({ grandTotal: 0, settlementStatus: 'PAID' });
  });
});

// ===========================================================================
describe('GST bills', () => {
  it('prices include GST: ₹1,530 = taxable + CGST + SGST, with the GSTIN and a tax table', async () => {
    await registerForGst();
    const bill = await checkout(desk, await completed());
    expect(bill).toMatchObject({ gstRegistered: true, grandTotal: 153000, taxableTotal: 129662, cgstTotal: 11669, sgstTotal: 11669, taxTotal: 23338 });
    expect(bill.seller).toMatchObject({ legalName: 'Glamour Studio Pvt Ltd', tradeName: 'Glamour', gstin: ANDHERI_GSTIN, stateCode: '27', stateName: 'Maharashtra' });
    expect(bill.taxSummary).toEqual([{ rateBps: 1800, taxableAmount: 129662, cgst: 11669, sgst: 11669 }]);
  });

  it('adds GST on top when the salon prices without it, and a service can have its own rate', async () => {
    await registerForGst({ pricesIncludeTax: false });
    await Service.updateOne({ _id: f.beardTrim._id }, { taxRateBps: 500, sacCode: '999722' });
    const bill = await checkout(desk, await completed([[f.haircut, f.rahul, 100000], [f.beardTrim, f.neha, 20000]]));
    expect(bill.lines.map((l) => [l.taxRateBps, l.cgst, l.lineTotal, l.sacCode])).toEqual([[1800, 9000, 118000, undefined], [500, 500, 21000, '999722']]);
    expect(bill.grandTotal).toBe(139000);
  });

  it("can't issue GST bills at a branch without a GSTIN", async () => {
    await registerForGst();
    const appt = await completed([[f.facial, f.arjun, 120000]], { branch: f.bandra });
    await expect(checkout(owner, appt)).rejects.toMatchObject({ code: 'GSTIN_MISSING' });
  });

  it('commission is earned on the price without GST, only once the bill is fully paid', async () => {
    await registerForGst();
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: new Date().toISOString().slice(0, 10) });
    const bill = await checkout(desk, await completed([[f.haircut, f.rahul, 118000]]), { payments: cash(18000) });
    expect(await CommissionEntry.countDocuments()).toBe(0); // part paid: nothing yet

    await recordPayments(desk, { invoiceId: bill._id, payments: cash(100000) }, key());
    const [entry] = await CommissionEntry.find().lean();
    expect(entry).toMatchObject({ saleAmount: 100000, amount: 10000, invoiceNumber: bill.invoiceNumber });
  });

  it('an issued bill keeps its prices, names and tax when the service or settings change later', async () => {
    await registerForGst();
    const bill = await checkout(desk, await completed());
    await Service.updateOne({ _id: f.haircut._id }, { name: 'Haircut Deluxe', price: 99900, taxRateBps: 500 });
    await BillingSettings.updateOne({}, { gstRegistered: false, legalName: 'Someone Else' });
    const again = await getInvoice(owner, bill._id);
    expect(again.lines[0]).toMatchObject({ name: 'Haircut', unitPrice: 153000, taxRateBps: 1800 });
    expect(again).toMatchObject({ grandTotal: bill.grandTotal, taxTotal: bill.taxTotal, seller: { legalName: 'Glamour Studio Pvt Ltd' } });
  });
});

// ===========================================================================
describe('Discount approval', () => {
  const over = { billDiscount: { type: 'percent', value: 15 } }; // limit is 10%

  it('front desk: above the limit waits for an owner; the owner approves; then it can be issued', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const quote = await quoteDraft(desk, draft._id, over);
    expect(quote.limits).toMatchObject({ limitBps: 1000, limitAmount: 15300, overLimit: true, needsApproval: true });
    await expect(issueInvoice(desk, draft._id, { version: 0, ...over, payments: [] }, key())).rejects.toMatchObject({ code: 'APPROVAL_NEEDED' });

    const waiting = await requestApproval(desk, draft._id, { version: 0, ...over, note: 'Regular customer' }, key());
    expect(waiting.approval).toMatchObject({ status: 'PENDING', requestedDiscount: 22950, requestedByName: 'Kavya' });
    const bells = await Notification.find().lean();
    expect(bells.map((n) => String(n.userId)).sort()).toEqual([owner.userId].sort()); // Andheri's approvers: the business owner
    expect(bells[0].link).toBe(`/app/invoices/${draft._id}`);
    await expect(issueInvoice(desk, draft._id, { version: waiting.version, payments: [] }, key())).rejects.toMatchObject({ code: 'APPROVAL_PENDING' });
    await expect(approveDiscount(desk, draft._id, { version: waiting.version }, key())).rejects.toMatchObject({ status: 403 });
    await expect(approveDiscount(bandraOwner, draft._id, { version: waiting.version }, key())).rejects.toMatchObject({ status: 404 }); // not his branch

    const approved = await approveDiscount(owner, draft._id, { version: waiting.version }, key());
    expect(approved.approval).toMatchObject({ status: 'APPROVED', approvedDiscount: 22950, decidedByName: 'Anita' });
    expect(await Notification.countDocuments({ userId: desk.userId })).toBe(1);

    const bill = await issueInvoice(desk, draft._id, { version: approved.version, payments: cash(130050) }, key());
    expect(bill).toMatchObject({ status: 'ISSUED', manualDiscount: 22950, grandTotal: 130050, settlementStatus: 'PAID' });
  });

  it('a bigger discount after approval needs approving again', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const waiting = await requestApproval(desk, draft._id, { version: 0, ...over }, key());
    const approved = await approveDiscount(owner, draft._id, { version: waiting.version }, key());
    await expect(issueInvoice(desk, draft._id, { version: approved.version, billDiscount: { type: 'percent', value: 20 }, payments: [] }, key())).rejects.toMatchObject({ code: 'APPROVAL_NEEDED' });
  });

  it('an owner can turn it down (with a reason) and can give big discounts directly', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const waiting = await requestApproval(desk, draft._id, { version: 0, ...over }, key());
    await expect(rejectDiscount(owner, draft._id, { version: waiting.version, note: '' }, key())).rejects.toBeDefined();
    const rejected = await rejectDiscount(owner, draft._id, { version: waiting.version, note: 'Max 10% this month' }, key());
    expect(rejected.approval).toMatchObject({ status: 'REJECTED', decisionNote: 'Max 10% this month' });

    const bill = await issueInvoice(owner, draft._id, { version: rejected.version, payments: [] }, key());
    expect(bill).toMatchObject({ status: 'ISSUED', manualDiscount: 22950 });
  });

  it('within the limit the front desk just issues', async () => {
    const bill = await checkout(desk, await completed(), { billDiscount: { type: 'percent', value: 10 } });
    expect(bill).toMatchObject({ status: 'ISSUED', manualDiscount: 15300 });
  });
});

// ===========================================================================
describe('Salon and branch walls', () => {
  it('other salons and other branches get "not found"', async () => {
    const appt = await completed();
    const bill = await checkout(desk, appt, { payments: cash(1000) });
    const desert = { ...f.ctxDesert, role: 'OWNER', userName: 'Fatima' };
    await expect(openDraft(desert, { appointmentId: appt._id })).rejects.toMatchObject({ status: 404 });
    await expect(getInvoice(desert, bill._id)).rejects.toMatchObject({ status: 404 });
    await expect(getInvoice(bandraOwner, bill._id)).rejects.toMatchObject({ status: 404 });
    await expect(recordPayments(bandraOwner, { invoiceId: bill._id, payments: cash(1000) }, key())).rejects.toMatchObject({ status: 404 });
    await expect(listInvoices(bandraOwner, { branchId: String(f.andheri._id), page: 1 })).rejects.toMatchObject({ status: 404 });
    expect((await listInvoices(desert, { branchId: 'all', page: 1 })).total).toBe(0);
  });
});

// ===========================================================================
describe('Bills list', () => {
  it('searches and filters, with totals', async () => {
    const paid = await checkout(desk, await completed());
    const part = await checkout(desk, await completed(), { payments: cash(50000) });
    await openDraft(desk, { appointmentId: (await completed())._id });

    const all = await listInvoices(owner, { branchId: 'all', page: 1 });
    expect(all.total).toBe(3);
    expect(all.totals).toEqual({ billed: 306000, paid: 203000, due: 103000, issued: 2 });
    expect((await listInvoices(owner, { branchId: 'all', status: 'DUE', page: 1 })).rows.map((r) => r.invoiceNumber)).toEqual([part.invoiceNumber]);
    expect((await listInvoices(owner, { branchId: 'all', status: 'DRAFT', page: 1 })).total).toBe(1);
    expect((await listInvoices(desk, { search: paid.invoiceNumber, page: 1 })).rows).toHaveLength(1);
    expect((await listInvoices(desk, { search: 'priya', status: 'PAID', page: 1 })).total).toBe(1);
    expect((await listInvoices(desk, { search: '98765', page: 1 })).total).toBe(3);
    expect((await listInvoices(desk, { from: '2020-01-01', to: '2020-01-31', page: 1 })).total).toBe(0);
    expect((await listInvoices(desk, { from: '2020-01-01', to: '2099-12-31', page: 1 })).total).toBe(3);
  });

  it('the dashboard lists unbilled visits and bills with dues', async () => {
    await completed();
    await checkout(desk, await completed(), { payments: cash(50000) });
    const { attention } = await getDashboard({ ...owner, activeBranchId: String(f.andheri._id) });
    expect(attention.filter((i) => i.kind === 'UNPAID')).toHaveLength(1);
    expect(attention.find((i) => i.kind === 'DUE')).toMatchObject({ title: 'Priya owes ₹1,030.00', action: { label: 'Record payment' } });
  });
});

// ===========================================================================
describe('Billing settings', () => {
  it('only the business owner changes them; GSTIN and prefixes are checked', async () => {
    await expect(updateSettings(bandraOwner, { gstRegistered: true }, key())).rejects.toMatchObject({ status: 403 });
    await expect(updateSettings(owner, { gstRegistered: true }, key())).rejects.toMatchObject({ code: 'LEGAL_NAME_REQUIRED' });
    await expect(updateSettings(owner, { branches: [{ branchId: String(f.andheri._id), gstin: '27AAKCG4821M1ZX' }] }, key())).rejects.toMatchObject({ code: 'INVALID_GSTIN' });
    await expect(updateSettings(owner, { branches: [{ branchId: String(f.andheri._id), gstin: ANDHERI_GSTIN, stateCode: '29' }] }, key())).rejects.toMatchObject({ code: 'INVALID_GSTIN' });
    await expect(
      updateSettings(owner, { branches: [{ branchId: String(f.andheri._id), invoicePrefix: 'GLM' }, { branchId: String(f.bandra._id), invoicePrefix: 'GLM' }] }, key())
    ).rejects.toMatchObject({ code: 'DUPLICATE_PREFIX' });

    await updateSettings(owner, { legalName: 'Glamour Pvt Ltd', gstRegistered: true, frontDeskDiscountLimitBps: 500, branches: [{ branchId: String(f.andheri._id), gstin: ANDHERI_GSTIN, invoicePrefix: 'GLA' }] }, key());
    const screen = await getSettingsForScreen(owner);
    expect(screen).toMatchObject({ gstRegistered: true, pricesIncludeTax: true, defaultServiceTaxBps: 1800, frontDeskDiscountLimitBps: 500, canEdit: true });
    expect(screen.branches.map((b) => [b.name, b.invoicePrefix, b.stateCode])).toEqual([['Andheri', 'GLA', '27'], ['Bandra', 'BAN', '']]);
    expect((await getSettingsForScreen(bandraOwner)).branches.map((b) => b.name)).toEqual(['Bandra']);
    expect((await ActivityLog.findOne({ action: 'billing.settings_changed' })).summary).toContain('GST registered: on');

    const bill = await checkout(desk, await completed());
    expect(bill.invoiceNumber).toBe(`GLA/${FY}/00001`);
  });

  it("a prefix already on another branch's bills can't be reused", async () => {
    await checkout(desk, await completed()); // AND/...
    await expect(updateSettings(owner, { branches: [{ branchId: String(f.bandra._id), invoicePrefix: 'AND' }] }, key())).rejects.toMatchObject({ code: 'DUPLICATE_PREFIX' });
  });
});

// ===========================================================================
describe('Bills made before Phase 1 (migration)', () => {
  // A bill saved the old way: one step, fully paid, payments inside the bill
  async function oldBill(appt, { number = 'GP-AND-000007', discount = 0, total = 153000, payments = [{ method: 'CARD', amount: 100000 }, { method: 'UPI', amount: 53000 }] } = {}) {
    const _id = new mongoose.Types.ObjectId();
    await Invoice.collection.insertOne({
      _id, orgId: new mongoose.Types.ObjectId(f.ctxGlamour.orgId), branchId: f.andheri._id, appointmentId: appt._id, customerId: f.priya._id,
      invoiceNumber: number, lines: appt.items.map((i) => ({ serviceName: i.serviceName, staffName: i.staffName, price: i.price })),
      subtotal: appt.totalPrice, discount, total, payments, paidAt: new Date('2026-03-31T12:00:00Z'), createdAt: new Date('2026-03-31T12:00:00Z'),
    });
    await Appointment.updateOne({ _id: appt._id }, { invoiceId: _id });
    return _id;
  }

  it('old bills become issued and paid, keep their numbers, and their payments move; running it twice changes nothing', async () => {
    const appt = await completed([[f.haircut, f.rahul, 50000], [f.beardTrim, f.neha, 20000]], { totalPrice: 60000, comboId: f.combo._id });
    const id = await oldBill(appt, { discount: 6000, total: 54000, payments: [{ method: 'CASH', amount: 54000 }] });

    expect(await migrateBilling({ log: () => {} })).toEqual({ migrated: 1, skipped: 0 });
    expect(await migrateBilling({ log: () => {} })).toEqual({ migrated: 0, skipped: 0 });

    const bill = await getInvoice(owner, id);
    expect(bill).toMatchObject({ status: 'ISSUED', settlementStatus: 'PAID', invoiceNumber: 'GP-AND-000007', financialYear: '25-26', grandTotal: 54000, amountPaid: 54000, balanceDue: 0, taxTotal: 0, subtotal: 70000, comboDiscountTotal: 10000, manualDiscount: 6000 });
    expect(bill.lines.map((l) => [l.name, l.taxableAmount, String(l.itemId)])).toEqual([['Haircut', 38571, String(appt.items[0]._id)], ['Beard Trim', 15429, String(appt.items[1]._id)]]);
    expect(bill.payments.map((p) => [p.method, p.amount, p.source])).toEqual([['CASH', 54000, 'MIGRATED']]);
    expect(await Payment.countDocuments()).toBe(1);
    const raw = await Invoice.collection.findOne({ _id: id });
    expect(raw.payments).toBeUndefined();
  });

  it('after the migration, drafts and new numbering work next to old bills', async () => {
    await oldBill(await completed());
    await migrateBilling({ log: () => {} });
    const bill = await checkout(desk, await completed());
    await openDraft(desk, { appointmentId: (await completed())._id });
    await openDraft(desk, { appointmentId: (await completed())._id }); // two drafts without numbers are fine
    expect(bill.invoiceNumber).toBe(`AND/${FY}/00001`);
    expect((await listInvoices(owner, { branchId: 'all', page: 1 })).total).toBe(4);
  });
});
