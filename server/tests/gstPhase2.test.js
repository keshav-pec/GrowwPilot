// GST Phase 2: the permanent tax record, credit notes and voids as new entries, part refunds by amount, older bills,
// the overview and sales register, who may see them, and the nightly check. G numbers are from the GST PRD.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import {
  Appointment, BillingSettings, CommissionEntry, Counter, CreditNote, GstCheck, GstRegistration, GstTaxEntry, GstTaxRule, IdempotencyRecord, InventoryBalance, InventorySku, Invoice, Notification, Organization, Payment, PaymentAllocation, PayPlan, Refund, Service, User,
} from '../src/models/index.js';
import { gstinCheckChar } from '../src/config/billing.js';
import * as gst from '../src/modules/gst/gst.service.js';
import { checkNow, overview, salesRegister } from '../src/modules/gst/gst.record.js';
import { runDueChecks, runTaxCheck } from '../src/modules/gst/gst.check.js';
import { addOlderDocuments, postBill } from '../src/modules/gst/gst.ledger.js';
import { creditForAmount, creditForLine } from '../src/modules/billing/tax.rules.js';
import { getBillingSettings, updateSettings } from '../src/modules/billing/settings.service.js';
import { runReport } from '../src/modules/billing/reports.service.js';
import { addProduct, createSaleDraft, getInvoice, issueInvoice, openDraft, voidInvoice } from '../src/modules/invoices/invoices.service.js';
import { approveRefund, createRefund, quoteRefund } from '../src/modules/refunds/refunds.service.js';
import { recordPayments, reversePayment } from '../src/modules/payments/payments.service.js';
import { createSku } from '../src/modules/inventory/skus/skus.service.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { migrateGst } from '../src/scripts/migrate-gst-v1.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

const GSTIN = (first14) => first14 + gstinCheckChar(first14);
const ANDHERI_GSTIN = GSTIN('27AAKCG4821M1Z');
const BANDRA_GSTIN = GSTIN('27AAKCG4821M2Z');
const INDIA = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(INDIA).toISODate();
const thisMonth = () => today().slice(0, 7);
const lastMonth = () => DateTime.now().setZone(INDIA).minus({ months: 1 }).toFormat('yyyy-MM');

let f;
let owner;
let bandraOwner;
let desk;
let shampoo;

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [anita, vikram, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita2@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram2@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya2@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  const base = { ...f.ctxGlamour, addons: ['inventory'], activeBranchId: String(f.andheri._id) };
  owner = { ...base, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  bandraOwner = { ...base, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
  desk = { ...base, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };
  shampoo = (await createSku(owner, { name: 'Shampoo', category: 'Retail', stockUnit: 'bottle', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 118000, openingQty: 500 }, key())).sku;
});
afterAll(stopDb);
afterEach(() => vi.restoreAllMocks());
beforeEach(async () => {
  await Promise.all([BillingSettings, GstRegistration, GstTaxRule, GstTaxEntry, GstCheck, Appointment, Invoice, Counter, Payment, PaymentAllocation, Refund, CreditNote, IdempotencyRecord, CommissionEntry, PayPlan, Notification].map((m) => m.deleteMany({})));
  await Service.updateMany({}, { $set: { taxRuleGroupId: null } });
  await InventorySku.updateMany({}, { $set: { taxRuleGroupId: null } });
});

function completed(price = 105000, { service = f.haircut, staff = f.rahul, branch = f.andheri, at = new Date() } = {}) {
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: branch._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: service._id, serviceName: service.name, staffId: staff._id, staffName: staff.name, startAt: at, endAt: at, durationMinutes: 30, price }],
    startAt: at, endAt: at, totalPrice: price, status: 'COMPLETED',
  });
}

// Andheri and Bandra each on their own GSTIN, with every service and product on an approved rule
async function ready({ startMonth = thisMonth() } = {}) {
  await gst.saveSetup(owner, { scheme: 'REGULAR', startMonth }, key());
  await gst.addRegistration(owner, { gstin: ANDHERI_GSTIN, legalName: 'Glamour Pvt Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.andheri._id)] }, key());
  await gst.addRegistration(owner, { gstin: BANDRA_GSTIN, legalName: 'Glamour Pvt Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.bandra._id)] }, key());
  const rule = await GstTaxRule.findOne({ orgId: f.ctxGlamour.orgId }).lean();
  await gst.approveRule(owner, String(rule._id), { reviewedBy: 'CA Mehta' }, key());
  await gst.linkUnlinked(owner, String(rule.groupId), key());
  const { ruleId } = await gst.createRule(owner, { name: 'Hair products', kind: 'PRODUCT', code: '3305', rateBps: 1800, itcType: 'WITH_ITC', from: '2025-09-22' }, key());
  await gst.approveRule(owner, ruleId, { reviewedBy: 'CA Mehta' }, key());
  await gst.linkUnlinked(owner, String((await GstTaxRule.findById(ruleId).lean()).groupId), key());
  await gst.testBill(owner, { branchId: String(f.andheri._id), lines: [{ groupId: String(rule.groupId), unitPrice: 105000, qty: 1 }] });
}
async function active(options) {
  await ready(options);
  await gst.activate(owner, key());
}
const entriesOf = (invoiceId) => GstTaxEntry.find({ invoiceId }).sort({ createdAt: 1 }).lean();
const productSale = async (qty = 1) => {
  let draft = await createSaleDraft(owner, { customerId: String(f.priya._id) });
  draft = await addProduct(owner, draft._id, { version: draft.version, skuId: String(shampoo._id), qty });
  return issueInvoice(owner, draft._id, { version: draft.version, payments: [{ method: 'CASH', amount: draft.grandTotal }] }, key());
};

// ===========================================================================
describe('Each issued bill gets one permanent entry', () => {
  it('saves the bill’s tax, GSTIN, month and lines', async () => {
    await active();
    const bill = await checkout(desk, await completed());
    const [entry, ...others] = await entriesOf(bill._id);
    expect(others).toEqual([]);
    expect(entry).toMatchObject({ type: 'BILL_ISSUED', documentNumber: bill.invoiceNumber, gstin: ANDHERI_GSTIN, period: thisMonth(), taxDate: today(), taxable: 100000, cgst: 2500, sgst: 2500, igst: 0, tax: 5000, total: 105000, createdByName: 'Kavya' });
    expect(entry.lines[0]).toMatchObject({ name: 'Haircut', code: '999721', rateBps: 500, itcType: 'WITHOUT_ITC', taxable: 100000, cgst: 2500 });
  });

  it('the same bill sent three times gives one entry (G08)', async () => {
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    const input = { version: draft.version, payments: [{ method: 'CASH', amount: 105000 }] };
    const sameKey = key();
    const first = await issueInvoice(owner, draft._id, input, sameKey);
    const again = await issueInvoice(owner, draft._id, input, sameKey);
    expect(again.invoiceNumber).toBe(first.invoiceNumber);
    await expect(issueInvoice(owner, draft._id, input, key())).rejects.toMatchObject({ code: 'ALREADY_ISSUED' });
    // Even posting it directly again changes nothing
    const invoice = await Invoice.findById(draft._id).lean();
    const settings = await getBillingSettings(owner);
    await mongoose.connection.transaction((session) => postBill(owner, invoice, settings, { taxDate: today() }, session));
    expect(await GstTaxEntry.countDocuments({ invoiceId: draft._id })).toBe(1);
  });

  it('two desks issuing at once still give one entry', async () => {
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    const input = { version: draft.version, payments: [{ method: 'CASH', amount: 105000 }] };
    const results = await Promise.allSettled([issueInvoice(owner, draft._id, input, key()), issueInvoice(desk, draft._id, input, key())]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await GstTaxEntry.countDocuments({ invoiceId: draft._id })).toBe(1);
  });

  it('a failure after the entry leaves neither the bill nor its entry (G42)', async () => {
    await active();
    await InventoryBalance.updateMany({ skuId: shampoo._id }, { $set: { qty: 0 } }); // issuing fails later, at the stock step
    let draft = await createSaleDraft(owner, { customerId: String(f.priya._id) });
    draft = await addProduct(owner, draft._id, { version: draft.version, skuId: String(shampoo._id), qty: 1 });
    await expect(issueInvoice(owner, draft._id, { version: draft.version, payments: [] }, key())).rejects.toMatchObject({ code: 'NOT_ENOUGH_STOCK' });
    expect(await GstTaxEntry.countDocuments({ invoiceId: draft._id })).toBe(0);
    const left = await Invoice.findById(draft._id).lean();
    expect(left.status).toBe('DRAFT');
    expect(left.invoiceNumber).toBeUndefined();
    await InventoryBalance.updateMany({ skuId: shampoo._id }, { $set: { qty: 500 } });
  });

  it('a failure saving the entry leaves the bill a draft, with its number unused (G42)', async () => {
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    vi.spyOn(GstTaxEntry, 'create').mockRejectedValueOnce(new Error('server stopped'));
    await expect(issueInvoice(owner, draft._id, { version: draft.version, payments: [] }, key())).rejects.toThrow('server stopped');
    expect((await Invoice.findById(draft._id).lean()).status).toBe('DRAFT');
    expect(await Payment.countDocuments()).toBe(0);
    const bill = await issueInvoice(owner, draft._id, { version: draft.version, payments: [] }, key());
    expect(bill.invoiceNumber.endsWith('/00001')).toBe(true);
    expect(await GstTaxEntry.countDocuments({ invoiceId: draft._id })).toBe(1);
  });

  it('an entry can never be changed', async () => {
    await active();
    const bill = await checkout(desk, await completed());
    await expect(GstTaxEntry.updateOne({ invoiceId: bill._id }, { $set: { taxable: 1 } })).rejects.toThrow('A tax entry cannot be changed');
    const entry = await GstTaxEntry.findOne({ invoiceId: bill._id });
    entry.taxable = 1;
    await expect(entry.save()).rejects.toThrow('A tax entry cannot be changed');
  });

  it('a bill under the wrong GSTIN is refused and doesn’t reach the record (G17)', async () => {
    await active();
    const bill = await checkout(desk, await completed());
    await GstTaxEntry.deleteMany({ invoiceId: bill._id });
    const invoice = { ...(await Invoice.findById(bill._id).lean()), seller: { gstin: BANDRA_GSTIN } };
    const settings = await getBillingSettings(owner);
    await expect(mongoose.connection.transaction((session) => postBill(owner, invoice, settings, { taxDate: today() }, session))).rejects.toMatchObject({ code: 'REGISTRATION_MISMATCH' });
    expect(await GstTaxEntry.countDocuments({ invoiceId: bill._id })).toBe(0);
  });

  it('salons that have not activated get no entries', async () => {
    await ready();
    await checkout(desk, await completed());
    expect(await GstTaxEntry.countDocuments()).toBe(0);
  });

  it('a start month ahead of today keeps this month’s bills out', async () => {
    await active({ startMonth: DateTime.now().setZone(INDIA).plus({ months: 1 }).toFormat('yyyy-MM') });
    const bill = await checkout(desk, await completed());
    expect(bill.gstSetupActive).toBe(true);
    expect(await GstTaxEntry.countDocuments()).toBe(0);
  });
});

// ===========================================================================
describe('Corrections are new minus entries', () => {
  it('a void adds a minus entry linked to the bill’s, which stays untouched', async () => {
    await active();
    const bill = await checkout(owner, await completed(), { payments: [] });
    const [original] = await entriesOf(bill._id);
    await voidInvoice(owner, bill._id, { reason: 'Billed by mistake' }, key());
    const [same, minus] = await entriesOf(bill._id);
    expect(same).toEqual(original);
    expect(minus).toMatchObject({ type: 'BILL_VOIDED', originalEntryId: original._id, documentNumber: bill.invoiceNumber, taxable: -100000, cgst: -2500, sgst: -2500, tax: -5000, total: -105000 });
    expect((await overview(owner, {})).net).toMatchObject({ taxable: 0, tax: 0, total: 0 });
  });

  it('a refund adds a minus entry linked to the bill and credit note; the bill’s entry stays (G09)', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const [original] = await entriesOf(bill._id);
    const { refund } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1 }], reason: 'Unhappy' }, key());
    const [same, minus] = await entriesOf(bill._id);
    expect(same).toEqual(original);
    expect(minus).toMatchObject({ type: 'CREDIT_NOTE', originalEntryId: original._id, documentNumber: refund.creditNoteNumber, taxable: -100000, tax: -5000, total: -105000 });
    expect(String(minus.refundId)).toBe(String(refund._id));
  });

  it('a refund waiting for an owner adds nothing until it is approved, and the approver is recorded', async () => {
    await active();
    const bill = await checkout(desk, await completed());
    const { refund } = await createRefund(desk, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Unhappy' }, key());
    expect(await GstTaxEntry.countDocuments({ invoiceId: bill._id })).toBe(1);
    await approveRefund(owner, refund._id, {}, key());
    const entries = await entriesOf(bill._id);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ taxable: -50000, createdByName: 'Anita' });
  });

  it('a minus entry stays under the GSTIN on the original bill, even after the GSTIN changed', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const newGstin = GSTIN('27AAKCG4821M3Z');
    const tomorrow = DateTime.now().setZone(INDIA).plus({ days: 1 }).toISODate();
    await gst.addRegistration(owner, { gstin: newGstin, legalName: 'Glamour Pvt Ltd', stateCode: '27', from: tomorrow, branchIds: [String(f.andheri._id)], move: true }, key());
    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1 }], reason: 'Unhappy' }, key());
    expect((await entriesOf(bill._id))[1].gstin).toBe(ANDHERI_GSTIN);
  });
});

// ===========================================================================
describe('Part refunds by amount', () => {
  const line = { name: 'Haircut', qty: 1, taxableAmount: 100000, cgst: 2500, sgst: 2500, igst: 0, lineTotal: 105000, taxRateBps: 500 };

  it('₹525 off a ₹1,050 haircut: ₹500 taxable and ₹25 tax', () => {
    expect(creditForAmount(line, 52500)).toEqual({ taxableAmount: 50000, cgst: 1250, sgst: 1250, igst: 0, amount: 52500, taxRateBps: 500 });
  });

  it('parts always add up to exactly the line, whatever the rounding', () => {
    let state = { ...line, taxableAmount: 476095, cgst: 11903, sgst: 11902, lineTotal: 499900, creditedTaxable: 0, creditedCgst: 0, creditedSgst: 0, creditedIgst: 0, creditedAmount: 0 };
    const add = (p) => { state = { ...state, creditedTaxable: state.creditedTaxable + p.taxableAmount, creditedCgst: state.creditedCgst + p.cgst, creditedSgst: state.creditedSgst + p.sgst, creditedIgst: state.creditedIgst + p.igst, creditedAmount: state.creditedAmount + p.amount }; };
    for (const amount of [1, 2, 3, 12345, 99999, 100001]) add(creditForAmount(state, amount));
    add(creditForAmount(state, state.lineTotal - state.creditedAmount));
    expect(state).toMatchObject({ creditedTaxable: 476095, creditedCgst: 11903, creditedSgst: 11902, creditedAmount: 499900 });
  });

  it('more than is left on the line is refused', () => {
    expect(() => creditForAmount(line, 105001)).toThrow('Only ₹1,050');
    expect(() => creditForAmount({ ...line, creditedAmount: 52500, creditedTaxable: 50000, creditedCgst: 1250, creditedSgst: 1250 }, 52501)).toThrow('Only ₹525');
    try { creditForAmount(line, 105001); } catch (err) { expect(err.code).toBe('CREDIT_EXCEEDS_ORIGINAL'); }
  });

  it('a half refund reverses ₹500 and ₹25 once only, even if retried, and the bill’s tax figures stay (G14, G15)', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const request = { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Half the service' };
    const sameKey = key();
    const { refund } = await createRefund(owner, request, sameKey);
    await createRefund(owner, request, sameKey);
    await createRefund(owner, request, sameKey);

    expect(await Refund.countDocuments({ invoiceId: bill._id })).toBe(1);
    expect(await CreditNote.countDocuments({ invoiceId: bill._id })).toBe(1);
    const entries = await entriesOf(bill._id);
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({ type: 'CREDIT_NOTE', taxable: -50000, cgst: -1250, sgst: -1250, tax: -2500, total: -52500 });

    const after = await getInvoice(owner, bill._id);
    expect(after).toMatchObject({ grandTotal: 105000, taxableTotal: 100000, taxTotal: 5000, creditedTotal: 52500, refundedTotal: 52500, refundStatus: 'PARTIAL', balanceDue: 0 });
    expect(after.lines[0]).toMatchObject({ taxableAmount: 100000, creditedTaxable: 50000, creditedAmount: 52500, refundedQty: 0 });
    expect(refund.lines[0]).toMatchObject({ qty: 0, partAmount: 52500, amount: 52500, taxableAmount: 50000 });
    expect((await overview(owner, {})).net).toMatchObject({ taxable: 50000, tax: 2500, total: 52500 });
  });

  it('the quote shows the same before anything is saved', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const plan = await quoteRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }] });
    expect(plan).toMatchObject({ creditTotal: 52500, cashRefund: 52500 });
    expect(await Refund.countDocuments()).toBe(0);
  });

  it('IGST bills refund as IGST', async () => {
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    const bill = await issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', payments: [{ method: 'CASH', amount: 105000 }] }, key());
    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    expect((await entriesOf(bill._id))[1]).toMatchObject({ taxable: -50000, cgst: 0, sgst: 0, igst: -2500 });
  });

  it('the rest can be refunded later; then the bill is fully refunded and nothing more can go', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const lineId = String(bill.lines[0]._id);
    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, partAmount: 52500 }], reason: 'Half' }, key());
    await expect(createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, partAmount: 60000 }], reason: 'Too much' }, key())).rejects.toMatchObject({ code: 'CREDIT_EXCEEDS_ORIGINAL' });
    const { invoice } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, qty: 1 }], reason: 'The rest' }, key());
    expect(invoice).toMatchObject({ refundStatus: 'FULL', creditedTotal: 105000, refundedTotal: 105000 });
    expect(invoice.lines[0]).toMatchObject({ refundedQty: 1, creditedTaxable: 100000, creditedCgst: 2500, creditedSgst: 2500 });
    await expect(createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, partAmount: 1 }], reason: 'More' }, key())).rejects.toMatchObject({ code: 'CREDIT_EXCEEDS_ORIGINAL' });
    expect((await overview(owner, {})).net).toMatchObject({ taxable: 0, tax: 0, total: 0 });
  });

  it('refunding all of a service by amount counts as a full refund', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const { invoice } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 105000 }], reason: 'All of it' }, key());
    expect(invoice.refundStatus).toBe('FULL');
    expect(invoice.lines[0].refundedQty).toBe(1);
  });

  it('commission comes back in the same share, and a later full refund takes the rest', async () => {
    await active();
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: today() });
    const bill = await checkout(owner, await completed());
    const lineId = String(bill.lines[0]._id);
    const sum = async () => (await CommissionEntry.find({ invoiceId: bill._id }).lean()).reduce((t, r) => t + r.amount, 0);
    expect(await sum()).toBe(10000); // 10% of ₹1,000

    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, partAmount: 52500 }], reason: 'Half' }, key());
    expect(await sum()).toBe(5000);
    const part = await CommissionEntry.findOne({ invoiceId: bill._id, type: 'part_reversal' }).lean();
    expect(part).toMatchObject({ saleAmount: -50000, amount: -5000 });

    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, qty: 1 }], reason: 'The rest' }, key());
    expect(await sum()).toBe(0);
  });

  it('a retried part refund takes commission back once', async () => {
    await active();
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: today() });
    const bill = await checkout(owner, await completed());
    const request = { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Half' };
    const sameKey = key();
    await createRefund(owner, request, sameKey);
    await createRefund(owner, request, sameKey);
    expect(await CommissionEntry.countDocuments({ invoiceId: bill._id, type: 'part_reversal' })).toBe(1);
  });

  it('a bill paid after a part refund earns commission only on what is left', async () => {
    await active();
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: today() });
    const bill = await checkout(owner, await completed(), { payments: [] });
    const { invoice } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    expect(invoice.balanceDue).toBe(52500);
    expect(await CommissionEntry.countDocuments({ invoiceId: bill._id })).toBe(0);
    await recordPayments(owner, { invoiceId: bill._id, payments: [{ method: 'CASH', amount: 52500 }] }, key());
    const [earned] = await CommissionEntry.find({ invoiceId: bill._id }).lean();
    expect(earned).toMatchObject({ saleAmount: 50000, amount: 5000 });
  });

  it('a wrong payment reversed, then a part refund, then paid again earns only on what is left', async () => {
    await active();
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: today() });
    const bill = await checkout(owner, await completed(), { payments: [{ method: 'CASH', amount: 105000 }] });
    const sum = async () => (await CommissionEntry.find({ invoiceId: bill._id }).lean()).reduce((t, r) => t + r.amount, 0);
    expect(await sum()).toBe(10000);
    const { payments } = await getInvoice(owner, bill._id);
    await reversePayment(owner, payments[0]._id, { reason: 'Card declined' }, key());
    expect(await sum()).toBe(0);
    const { invoice } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    expect(invoice.balanceDue).toBe(52500);
    await recordPayments(owner, { invoiceId: bill._id, payments: [{ method: 'CASH', amount: 52500 }] }, key());
    expect(await sum()).toBe(5000);
  });

  it('a product part refund is money only: nothing goes back in stock, and units can still come back for what is left', async () => {
    await active();
    const stock = async () => (await InventoryBalance.find({ skuId: shampoo._id }).lean()).reduce((s, b) => s + b.qty, 0);
    const bill = await productSale(3); // 3 x ₹1,180
    const lineId = String(bill.lines[0]._id);
    const before = await stock();
    const { refund } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, partAmount: 300000 }], reason: 'Scratched bottles' }, key());
    expect(refund.lines[0]).toMatchObject({ qty: 0, restock: null });
    expect(await stock()).toBe(before);
    // One bottle comes back, but only ₹540 of the line's value is left
    const { refund: second, invoice } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId, qty: 1, restock: 'SELLABLE' }], reason: 'Returned' }, key());
    expect(second.creditTotal).toBeLessThanOrEqual(54000);
    expect(await stock()).toBe(before + 1);
    expect(invoice.creditedTotal).toBeLessThanOrEqual(354000);
  });

  it('units left can’t take more than the value left', () => {
    const three = { name: 'Gel', qty: 3, refundedQty: 0, taxableAmount: 30000, cgst: 0, sgst: 0, igst: 0, lineTotal: 30000, creditedTaxable: 25000, creditedCgst: 0, creditedSgst: 0, creditedIgst: 0, creditedAmount: 25000, taxRateBps: 0 };
    expect(creditForLine(three, 1).amount).toBe(5000);
    expect(creditForLine({ ...three, refundedQty: 0 }, 3).amount).toBe(5000);
    expect(() => creditForLine({ ...three, creditedAmount: 30000, creditedTaxable: 30000 }, 1)).toThrow('already been refunded');
  });

  it('works for plain bills too, with a refund receipt and no credit note', async () => {
    const bill = await checkout(owner, await completed());
    const { refund, invoice } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    expect(invoice).toMatchObject({ gstRegistered: false, creditedTotal: 52500, refundStatus: 'PARTIAL' });
    expect(refund.creditNoteId).toBe(null);
    expect(refund.lines[0]).toMatchObject({ taxableAmount: 52500, amount: 52500 });
    expect(await GstTaxEntry.countDocuments()).toBe(0);
  });
});

// ===========================================================================
describe('Older bills', () => {
  // A salon billing in Billing settings before it activates
  async function legacySalon() {
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: ANDHERI_GSTIN, stateCode: '27' }, { branchId: f.bandra._id, gstin: BANDRA_GSTIN, stateCode: '27' }] });
  }
  async function activateMovedSalon() {
    await gst.saveSetup(owner, { scheme: 'REGULAR', startMonth: thisMonth() }, key());
    await GstRegistration.updateMany({ orgId: f.ctxGlamour.orgId }, { $set: { from: '2025-01-01', 'branches.$[].from': '2025-01-01' } });
    const rule = await GstTaxRule.findOne({ orgId: f.ctxGlamour.orgId }).lean();
    await gst.approveRule(owner, String(rule._id), { reviewedBy: 'CA Mehta' }, key());
    await gst.linkUnlinked(owner, String(rule.groupId), key());
    const { ruleId } = await gst.createRule(owner, { name: 'Hair products', kind: 'PRODUCT', code: '3305', rateBps: 1800, itcType: 'WITH_ITC', from: '2025-09-22' }, key());
    await gst.approveRule(owner, ruleId, { reviewedBy: 'CA Mehta' }, key());
    await gst.linkUnlinked(owner, String((await GstTaxRule.findById(ruleId).lean()).groupId), key());
    await gst.testBill(owner, { branchId: String(f.andheri._id), lines: [{ groupId: String(rule.groupId), unitPrice: 105000, qty: 1 }] });
    await gst.activate(owner, key());
  }

  it('GST bills from the start month on are added on activating, once only, with their credit notes and voids', async () => {
    await legacySalon();
    const kept = await checkout(owner, await completed(118000));
    const refunded = await checkout(owner, await completed(118000));
    await createRefund(owner, { invoiceId: refunded._id, lines: [{ lineId: String(refunded.lines[0]._id), qty: 1 }], reason: 'Unhappy' }, key());
    const voided = await checkout(owner, await completed(118000), { payments: [] });
    await voidInvoice(owner, voided._id, { reason: 'Mistake' }, key());

    await activateMovedSalon();
    expect((await entriesOf(kept._id)).map((e) => e.type)).toEqual(['BILL_ISSUED']);
    expect((await entriesOf(refunded._id)).map((e) => e.type).sort()).toEqual(['BILL_ISSUED', 'CREDIT_NOTE']);
    expect((await entriesOf(voided._id)).map((e) => e.type).sort()).toEqual(['BILL_ISSUED', 'BILL_VOIDED']);
    const [first] = await entriesOf(kept._id);
    expect(first).toMatchObject({ addedLater: true, taxable: kept.taxableTotal, cgst: kept.cgstTotal, gstin: ANDHERI_GSTIN, placeOfSupply: { stateCode: '27', stateName: 'Maharashtra' } });
    const refundEntries = await entriesOf(refunded._id);
    const minus = refundEntries.find((e) => e.type === 'CREDIT_NOTE');
    expect(String(minus.originalEntryId)).toBe(String(refundEntries.find((e) => e.type === 'BILL_ISSUED')._id));

    const count = await GstTaxEntry.countDocuments();
    const settings = await getBillingSettings(owner);
    expect((await addOlderDocuments(owner.orgId, settings)).added).toBe(0);
    await migrateGst({ log: () => {} });
    expect(await GstTaxEntry.countDocuments()).toBe(count);
    expect((await runTaxCheck(new mongoose.Types.ObjectId(owner.orgId))).differences).toEqual([]);
  });

  it('earlier months stay out, and plain bills never go in', async () => {
    await legacySalon();
    const old = await checkout(owner, await completed(118000));
    await Invoice.updateOne({ _id: old._id }, { $set: { issuedAt: DateTime.now().setZone(INDIA).minus({ months: 2 }).toJSDate(), taxDate: DateTime.now().setZone(INDIA).minus({ months: 2 }).toISODate() } });
    await activateMovedSalon();
    expect(await GstTaxEntry.countDocuments({ invoiceId: old._id })).toBe(0);
    expect((await runTaxCheck(new mongoose.Types.ObjectId(owner.orgId))).differences).toEqual([]);
  });

  it('a credit note this month on a bill from before the start month still counts, with no original to link', async () => {
    await legacySalon();
    const old = await checkout(owner, await completed(118000));
    await Invoice.updateOne({ _id: old._id }, { $set: { issuedAt: DateTime.now().setZone(INDIA).minus({ months: 2 }).toJSDate(), taxDate: DateTime.now().setZone(INDIA).minus({ months: 2 }).toISODate() } });
    await activateMovedSalon();
    await createRefund(owner, { invoiceId: old._id, lines: [{ lineId: String(old.lines[0]._id), qty: 1 }], reason: 'Late complaint' }, key());
    const [entry, ...rest] = await entriesOf(old._id);
    expect(rest).toEqual([]);
    expect(entry.type).toBe('CREDIT_NOTE');
    expect(entry.originalEntryId).toBeUndefined();
  });

  it('a salon activated before the record existed gets its bills added when the server starts', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    await GstTaxEntry.deleteMany({});
    await BillingSettings.updateOne({ orgId: owner.orgId }, { $unset: { 'gst.recordFrom': '' } });
    const { added } = await migrateGst({ log: () => {} });
    expect(added).toBe(1);
    expect(await GstTaxEntry.countDocuments({ invoiceId: bill._id })).toBe(1);
  });

  it('a bill under a GSTIN its branch never had stays out, and the check lists it (G17)', async () => {
    await legacySalon();
    const bill = await checkout(owner, await completed(118000));
    await Invoice.updateOne({ _id: bill._id }, { $set: { 'seller.gstin': GSTIN('29AABCT3518Q1Z') } });
    await activateMovedSalon();
    expect(await GstTaxEntry.countDocuments({ invoiceId: bill._id })).toBe(0);
    const { differences } = await runTaxCheck(new mongoose.Types.ObjectId(owner.orgId));
    expect(differences[0]).toMatchObject({ code: 'GSTIN_DIFFERENT', link: `/app/invoices/${bill._id}` });
  });
});

// ===========================================================================
describe('Overview, sales register and report', () => {
  it('the overview shows the period’s output tax, per GSTIN', async () => {
    await active();
    await checkout(owner, await completed());
    await checkout(owner, await completed(120000, { service: f.facial, staff: f.arjun, branch: f.bandra }));
    const all = await overview(owner, {});
    expect(all).toMatchObject({ active: true, month: thisMonth(), net: { count: 2, taxable: 214286, total: 225000 }, bills: { count: 2 } });
    expect(all.net.tax).toBe(5000 + 5714);
    expect(all.gstins.map((g) => g.gstin).sort()).toEqual([ANDHERI_GSTIN, BANDRA_GSTIN].sort());
    const one = await overview(owner, { gstin: ANDHERI_GSTIN });
    expect(one.net).toMatchObject({ count: 1, taxable: 100000, tax: 5000 });
    expect((await overview(owner, { month: lastMonth() })).net).toMatchObject({ count: 0, tax: 0 });
  });

  it('the register lists each entry with a link to its bill, with filters and totals', async () => {
    await active();
    const a = await checkout(owner, await completed());
    const b = await checkout(owner, await completed());
    await createRefund(owner, { invoiceId: b._id, lines: [{ lineId: String(b.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());

    const register = await salesRegister(owner, {});
    expect(register.total).toBe(3);
    expect(register.totals).toMatchObject({ taxable: 150000, tax: 7500, total: 157500 });
    const row = register.rows.find((r) => r.documentNumber === a.invoiceNumber);
    expect(row).toMatchObject({ type: 'Bill', gstin: ANDHERI_GSTIN, branch: 'Andheri', customer: 'Priya', place: 'Maharashtra', taxable: 100000, cgst: 2500 });
    expect(String(row.invoiceId)).toBe(String(a._id));

    expect((await salesRegister(owner, { type: 'CREDIT_NOTE' })).rows.map((r) => r.total)).toEqual([-52500]);
    expect((await salesRegister(owner, { search: a.invoiceNumber })).total).toBe(1);
    expect((await salesRegister(owner, { gstin: BANDRA_GSTIN })).total).toBe(0);
    expect((await salesRegister(owner, { month: lastMonth() })).total).toBe(0);
  });

  it('“GST collected” reads the record, so it agrees with the register (G46)', async () => {
    await active();
    const a = await checkout(owner, await completed());
    await checkout(owner, await completed(), { payments: [] }).then((v) => voidInvoice(owner, v._id, { reason: 'Mistake' }, key()));
    await createRefund(owner, { invoiceId: a._id, lines: [{ lineId: String(a.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    const report = await runReport(owner, 'gst', { branches: 'all' });
    const register = await salesRegister(owner, {});
    expect(report.totals).toMatchObject({ taxable: 100000, cgst: 2500, sgst: 2500, creditTaxable: 50000, creditCgst: 1250, netTaxable: 50000, netCgst: 1250, netSgst: 1250 });
    expect(report.totals.netTaxable).toBe(register.totals.taxable);
    expect(report.totals.netCgst + report.totals.netSgst).toBe(register.totals.tax);
  });

  it('months before the start month still report from the bills themselves', async () => {
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: ANDHERI_GSTIN, stateCode: '27' }, { branchId: f.bandra._id, gstin: BANDRA_GSTIN, stateCode: '27' }] });
    const old = await checkout(owner, await completed(118000));
    const earlier = DateTime.now().setZone(INDIA).minus({ months: 2 });
    await Invoice.updateOne({ _id: old._id }, { $set: { issuedAt: earlier.toJSDate(), taxDate: earlier.toISODate() } });
    await BillingSettings.updateOne({ orgId: owner.orgId }, { $set: { 'gst.status': 'ACTIVE', 'gst.startMonth': thisMonth(), 'gst.recordFrom': new Date() } });
    const report = await runReport(owner, 'gst', { from: earlier.minus({ days: 1 }).toISODate(), to: today(), branches: 'all' });
    expect(report.totals.taxable).toBe(old.taxableTotal);
  });
});

// ===========================================================================
describe('The nightly check', () => {
  const org = () => new mongoose.Types.ObjectId(owner.orgId);

  it('everything matches after retries, and no bell rings (G46)', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    const voided = await checkout(owner, await completed(), { payments: [] });
    await voidInvoice(owner, voided._id, { reason: 'Mistake' }, key());
    const result = await runTaxCheck(org());
    expect(result).toMatchObject({ checked: 4, differences: [] });
    expect(await Notification.countDocuments()).toBe(0);
    expect((await overview(owner, {})).check).toMatchObject({ checked: 4, differences: [] });
  });

  it('finds a missing entry and a changed amount, links to the bill, and rings the bell once', async () => {
    await active();
    const missing = await checkout(owner, await completed());
    const changed = await checkout(owner, await completed());
    await GstTaxEntry.deleteOne({ invoiceId: missing._id });
    await Invoice.collection.updateOne({ _id: new mongoose.Types.ObjectId(changed._id) }, { $set: { taxableTotal: 99000 } });

    const { differences } = await runTaxCheck(org());
    expect(differences.map((d) => d.code).sort()).toEqual(['AMOUNT_DIFFERENT', 'ENTRY_MISSING']);
    expect(differences.find((d) => d.code === 'ENTRY_MISSING')).toMatchObject({ link: `/app/invoices/${missing._id}`, message: expect.stringContaining(missing.invoiceNumber) });
    const bells = await Notification.find({ userId: owner.userId }).lean();
    expect(bells).toHaveLength(1);
    expect(bells[0]).toMatchObject({ link: '/app/gst', message: expect.stringContaining('2 differences') });

    // The same problems the next night: listed, but no second bell
    await runTaxCheck(org());
    expect(await Notification.countDocuments({ userId: owner.userId })).toBe(1);
    expect((await overview(owner, {})).check.differences).toHaveLength(2);
  });

  it('finds an entry with no bill behind it', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    await Invoice.deleteOne({ _id: bill._id });
    const { differences } = await runTaxCheck(org());
    expect(differences.map((d) => d.code)).toEqual(['SOURCE_MISSING']);
  });

  it('the timer runs each active salon once a night, from 2 am', async () => {
    await active();
    const at = (hour) => DateTime.now().setZone(INDIA).set({ hour, minute: 0 }).toJSDate();
    expect(await runDueChecks(at(1))).toBe(0);
    expect(await runDueChecks(at(3))).toBe(1);
    expect(await runDueChecks(at(4))).toBe(0);
    expect((await GstCheck.findOne({ orgId: owner.orgId }).lean()).ranAt).toBeTruthy();
    expect(await runDueChecks(DateTime.now().setZone(INDIA).plus({ days: 1 }).set({ hour: 3 }).toJSDate())).toBe(1);
  });

  it('salons not active are skipped', async () => {
    await ready();
    expect(await runTaxCheck(org())).toBe(null);
    expect(await runDueChecks()).toBe(0);
    await expect(checkNow(owner, key())).rejects.toMatchObject({ code: 'GST_NOT_ACTIVE' });
  });

  it('only the business owner can run it by hand', async () => {
    await active();
    await expect(checkNow(bandraOwner, key())).rejects.toMatchObject({ status: 403 });
    expect(await checkNow(owner, key())).toMatchObject({ differences: 0 });
  });
});

// ===========================================================================
describe('Who can see what', () => {
  it('branch owners need the switch, then see their own branches only', async () => {
    await active();
    const andheriBill = await checkout(owner, await completed());
    const bandraBill = await checkout(owner, await completed(120000, { service: f.facial, staff: f.arjun, branch: f.bandra }));
    await expect(overview(bandraOwner, {})).rejects.toMatchObject({ status: 403 });
    await expect(salesRegister(bandraOwner, {})).rejects.toMatchObject({ status: 403 });
    expect((await gst.getSetup(bandraOwner)).canViewTax).toBe(false);

    await updateSettings(owner, { branchOwners: { viewGst: true } }, key());
    expect((await gst.getSetup(bandraOwner)).canViewTax).toBe(true);
    const register = await salesRegister(bandraOwner, {});
    expect(register.rows.map((r) => r.documentNumber)).toEqual([bandraBill.invoiceNumber]);
    expect(register.totals.total).toBe(120000);
    expect((await salesRegister(bandraOwner, { gstin: ANDHERI_GSTIN })).total).toBe(0);
    expect((await overview(bandraOwner, {})).gstins.map((g) => g.gstin)).toEqual([BANDRA_GSTIN]);
    expect((await salesRegister(owner, {})).rows.map((r) => r.documentNumber)).toContain(andheriBill.invoiceNumber);
  });

  it('a branch owner only sees differences at their own branches', async () => {
    await active();
    await updateSettings(owner, { branchOwners: { viewGst: true } }, key());
    const bill = await checkout(owner, await completed());
    await GstTaxEntry.deleteOne({ invoiceId: bill._id });
    await runTaxCheck(new mongoose.Types.ObjectId(owner.orgId));
    expect((await overview(owner, {})).check.differences).toHaveLength(1);
    expect((await overview(bandraOwner, {})).check.differences).toHaveLength(0);
  });

  it('another salon sees nothing of this one (G41)', async () => {
    await active();
    await checkout(owner, await completed());
    const other = { ...f.ctxDesert, userName: 'Fatima', role: 'OWNER', isPrimaryOwner: true };
    expect((await salesRegister(other, {})).total).toBe(0);
    expect((await overview(other, {})).net.count).toBe(0);
    expect((await overview(other, {})).gstins).toEqual([]);
    expect((await salesRegister(other, { gstin: ANDHERI_GSTIN })).total).toBe(0);
  });
});

// Through the real API
describe('The tax record through the API', () => {
  const PASSWORD = 'Password@123';
  let server;
  let api;
  const cookies = {};
  const call = async (who, method, path, body) => {
    const headers = { 'content-type': 'application/json', 'idempotency-key': `test-${new mongoose.Types.ObjectId()}` };
    if (who) headers.cookie = cookies[who];
    const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, text: type.includes('csv') ? await res.text() : null, json: type.includes('json') ? await res.json() : null };
  };

  beforeAll(async () => {
    const g = f.ctxGlamour.orgId;
    await Organization.updateOne({ _id: g }, { $set: { 'addons.inventory.enabled': true } });
    const passwordHash = await hashPassword(PASSWORD);
    await User.create([
      { orgId: g, role: 'OWNER', name: 'Biz', email: 'biz2@g.com', passwordHash, allBranches: true },
      { orgId: g, role: 'OWNER', name: 'Bran', email: 'bran2@g.com', passwordHash, branchIds: [f.bandra._id] },
      { orgId: g, role: 'FRONT_DESK', name: 'Desk', email: 'desk2@g.com', passwordHash, branchIds: [f.andheri._id] },
      { orgId: g, role: 'INVENTORY', name: 'Stock', email: 'stock2@g.com', passwordHash, branchIds: [f.andheri._id] },
    ]);
    server = app.listen(0);
    api = `http://127.0.0.1:${server.address().port}/api`;
    for (const [who, email] of Object.entries({ business: 'biz2@g.com', branch: 'bran2@g.com', desk: 'desk2@g.com', stock: 'stock2@g.com' })) {
      const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      cookies[who] = res.headers.get('set-cookie')?.split(';')[0];
    }
  });
  afterAll(() => server?.close());

  it.each([
    ['overview', 'GET', '/gst/overview', { business: 200, branch: 403, desk: 403, stock: 403 }],
    ['register', 'GET', '/gst/register', { business: 200, branch: 403, desk: 403, stock: 403 }],
    ['run the check', 'POST', '/gst/check', { business: 409, branch: 403, desk: 403, stock: 403 }],
  ])('%s', async (_label, method, path, expected) => {
    for (const [who, status] of Object.entries(expected)) expect([who, (await call(who, method, path)).status]).toEqual([who, status]);
    expect((await call(null, method, path)).status).toBe(401);
  });

  it('the front desk still sees the tax on a bill it issued', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const seen = await call('desk', 'GET', `/invoices/${bill._id}`);
    expect(seen.status).toBe(200);
    expect(seen.json.invoice).toMatchObject({ cgstTotal: 2500, sgstTotal: 2500 });
  });

  it('downloads the register as CSV in rupees, and checks what is sent', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const csv = await call('business', 'GET', `/gst/register?format=csv&month=${thisMonth()}`);
    expect(csv.status).toBe(200);
    expect(csv.type).toContain('csv');
    expect(csv.text).toContain('Taxable');
    expect(csv.text).toContain(bill.invoiceNumber);
    expect(csv.text).toContain('1000.00');
    expect((await call('business', 'GET', '/gst/register?month=2026-13')).status).toBe(400);
  });

  it('refund lines need how many or how much, not both', async () => {
    await active();
    const bill = await checkout(owner, await completed());
    const lineId = String(bill.lines[0]._id);
    const post = (line) => call('business', 'POST', '/refunds/quote', { invoiceId: bill._id, lines: [{ lineId, ...line }] });
    expect((await post({})).status).toBe(400);
    expect((await post({ qty: 1, partAmount: 100 })).status).toBe(400);
    expect((await post({ partAmount: 0 })).status).toBe(400);
    expect((await post({ partAmount: 52500 })).json).toMatchObject({ creditTotal: 52500 });
  });

  it('the switch for branch owners is on Billing settings', async () => {
    await active();
    expect((await call('branch', 'PATCH', '/billing/settings', { branchOwners: { viewGst: true } })).status).toBe(403);
    expect((await call('business', 'PATCH', '/billing/settings', { branchOwners: { viewGst: true } })).json.branchOwners.viewGst).toBe(true);
    expect((await call('branch', 'GET', '/gst/overview')).status).toBe(200);
    await call('business', 'PATCH', '/billing/settings', { branchOwners: { viewGst: false } });
  });
});
