// Billing Phase 2: selling products, refunds and credit notes, voids, customer advances, payment reversals
// and the stock and commission that go with them.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  ActivityLog, Appointment, BillingSettings, CommissionEntry, Counter, CreditNote, CustomerAdvance, IdempotencyRecord, InventoryBalance, InventoryLedgerEntry,
  InventoryTransaction, Invoice, Notification, Payment, PaymentAllocation, PayPlan, Refund, User,
} from '../src/models/index.js';
import {
  addProduct, createSaleDraft, discardDraft, getInvoice, issueInvoice, listSellableProducts, openDraft, quoteDraft, removeLine, saveDraft, voidInvoice,
} from '../src/modules/invoices/invoices.service.js';
import { customerAdvances, recordPayments, reversePayment, takeAdvance } from '../src/modules/payments/payments.service.js';
import { approveRefund, createRefund, quoteRefund, rejectRefund } from '../src/modules/refunds/refunds.service.js';
import { updateSettings } from '../src/modules/billing/settings.service.js';
import { createSku } from '../src/modules/inventory/skus/skus.service.js';
import { reconcile } from '../src/modules/inventory/stock/stock.engine.js';
import { financialYear, formatCreditNoteNumber, gstinCheckChar } from '../src/config/billing.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

let f;
let owner; // business owner
let andheriOwner; // branch owner of Andheri
let desk; // front desk at Andheri
let serum; // a retail product: ₹1,180, 10 in the store
let gel; // a second retail product: ₹500, 2 in the store
let colour; // a professional product: not for sale
const FY = financialYear(new Date(), 'Asia/Kolkata');
const GSTIN = (first14) => first14 + gstinCheckChar(first14);
const today = () => new Date().toISOString().slice(0, 10);

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [anita, meera, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Meera', email: 'meera@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  const base = { ...f.ctxGlamour, addons: ['inventory'], activeBranchId: String(f.andheri._id) };
  owner = { ...base, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  andheriOwner = { ...base, userId: String(meera._id), userName: 'Meera', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };
  desk = { ...base, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };

  const product = async (input) => (await createSku(owner, input, key())).sku;
  serum = await product({ name: 'Hair serum', category: 'Retail', stockUnit: 'bottle', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 118000, hsnCode: '3305', openingQty: 10, openingUnitCost: 50000, barcodes: ['8900000000017'] });
  gel = await product({ name: 'Styling gel', category: 'Retail', stockUnit: 'tub', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 50000, taxRateBps: 500, openingQty: 2 });
  colour = await product({ name: 'Colour tube', category: 'Colour', stockUnit: 'tube', wayOfUse: 'MANUAL', type: 'PROFESSIONAL', sellPrice: 40000, openingQty: 5 });
});
afterAll(stopDb);

// Each test starts with full shelves and no bills
let shelf;
beforeEach(async () => {
  await Promise.all(
    [Appointment, Invoice, Counter, Payment, PaymentAllocation, CustomerAdvance, Refund, CreditNote, BillingSettings, CommissionEntry, PayPlan, ActivityLog, Notification, IdempotencyRecord].map((m) => m.deleteMany({}))
  );
  // Put the stock back to the opening amounts (only movements made by bills are removed)
  const sales = await InventoryTransaction.find({ type: { $in: ['SALE', 'SALE_RETURN', 'WRITE_OFF'] } }).select('_id').lean();
  if (sales.length) {
    await InventoryLedgerEntry.collection.deleteMany({ transactionId: { $in: sales.map((s) => s._id) } });
    await InventoryTransaction.collection.deleteMany({ _id: { $in: sales.map((s) => s._id) } });
  }
  shelf ??= await InventoryBalance.find().lean();
  for (const b of shelf) await InventoryBalance.collection.updateOne({ _id: b._id }, { $set: { qty: b.qty } });
});

async function inStore(sku) {
  const rows = await InventoryBalance.find({ skuId: sku._id }).lean();
  return rows.reduce((sum, r) => sum + r.qty, 0);
}

function completed(lines = [[f.haircut, f.rahul, 100000]]) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: lines.map(([service, stylist, price]) => ({ serviceId: service._id, serviceName: service.name, staffId: stylist._id, staffName: stylist.name, startAt: start, endAt: start, durationMinutes: 30, price })),
    startAt: start, endAt: start, totalPrice: lines.reduce((sum, l) => sum + l[2], 0), status: 'COMPLETED',
  });
}

async function registerForGst() {
  await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: GSTIN('27AAKCG4821M1Z'), stateCode: '27' }] });
}

// A product-only sale to Priya: [[sku, qty]], issued with `payments` (default: paid in full in cash)
async function sell(items, { payments, ctx = desk } = {}) {
  let draft = await createSaleDraft(ctx, { customerId: String(f.priya._id) });
  for (const [sku, qty] of items) draft = await addProduct(ctx, draft._id, { version: draft.version, skuId: String(sku._id), qty });
  return issueInvoice(ctx, draft._id, { version: draft.version, payments: payments ?? [{ method: 'CASH', amount: draft.grandTotal }] }, key());
}
const lineOf = (bill, name) => bill.lines.find((l) => l.name === name);

// ===========================================================================
describe('Selling products', () => {
  it('only retail products with a price can be sold; search finds them by name or barcode, with stock', async () => {
    const found = await listSellableProducts(desk, { search: '8900000000017' });
    expect(String(found.exactMatchId)).toBe(String(serum._id));
    expect(found.rows[0]).toMatchObject({ name: 'Hair serum', sellPrice: 118000, inStore: 10 });
    expect((await listSellableProducts(desk, {})).rows.map((r) => r.name)).toEqual(['Hair serum', 'Styling gel']);

    const draft = await createSaleDraft(desk, { customerId: String(f.priya._id) });
    await expect(addProduct(desk, draft._id, { version: 0, skuId: String(colour._id), qty: 1 })).rejects.toMatchObject({ code: 'NOT_FOR_SALE' });
    await expect(listSellableProducts({ ...desk, addons: [] }, {})).rejects.toMatchObject({ status: 403 });
  });

  it('a product sale takes stock out exactly once, with GST and HSN on the line', async () => {
    await registerForGst();
    const bill = await sell([[serum, 2], [gel, 1]]);
    expect(bill).toMatchObject({ status: 'ISSUED', settlementStatus: 'PAID', invoiceNumber: `AND/${FY}/00001`, grandTotal: 286000 });
    expect(lineOf(bill, 'Hair serum')).toMatchObject({ kind: 'PRODUCT', qty: 2, hsnCode: '3305', taxRateBps: 1800, taxableAmount: 200000, cgst: 18000, lineTotal: 236000 });
    expect(lineOf(bill, 'Styling gel')).toMatchObject({ taxRateBps: 500, lineTotal: 50000 });
    expect([await inStore(serum), await inStore(gel)]).toEqual([8, 1]);
    const sale = await InventoryTransaction.find({ type: 'SALE' }).lean();
    expect(sale.map((t) => t.requestKey).sort()).toEqual(bill.lines.map((l) => `sale:${bill._id}:${l._id}`).sort());
    expect(await reconcile(owner)).toEqual([]);
  });

  it('not enough stock blocks the issue, and nothing is saved', async () => {
    let draft = await createSaleDraft(desk, { customerId: String(f.priya._id) });
    draft = await addProduct(desk, draft._id, { version: 0, skuId: String(gel._id), qty: 3 });
    expect(draft.stock[String(gel._id)]).toBe(2);
    await expect(issueInvoice(desk, draft._id, { version: draft.version, payments: [] }, key())).rejects.toMatchObject({ code: 'NOT_ENOUGH_STOCK', message: 'Not enough Styling gel in stock: 2 left in Main store' });
    expect((await Invoice.findById(draft._id)).status).toBe('DRAFT');
    expect(await inStore(gel)).toBe(2);
    expect(await Counter.countDocuments()).toBe(0);
  });

  it('adds products to an appointment checkout too; quantities change and products can be removed', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const withSerum = await addProduct(desk, draft._id, { version: 0, skuId: String(serum._id), qty: 1 });
    const twice = await addProduct(desk, draft._id, { version: withSerum.version, skuId: String(serum._id), qty: 1 });
    expect(lineOf(twice, 'Hair serum').qty).toBe(2);
    const three = await saveDraft(desk, draft._id, { version: twice.version, lines: [{ lineId: String(lineOf(twice, 'Hair serum')._id), qty: 3 }] });
    expect(three.grandTotal).toBe(100000 + 3 * 118000);
    await expect(removeLine(desk, draft._id, String(three.lines[0]._id), { version: three.version })).rejects.toMatchObject({ status: 400 }); // a service
    const removed = await removeLine(desk, draft._id, String(lineOf(three, 'Hair serum')._id), { version: three.version });
    expect(removed.lines).toHaveLength(1);
  });

  it('guest sales only when the salon allows them; an empty draft can be thrown away', async () => {
    await expect(createSaleDraft(desk, { customerId: null })).rejects.toMatchObject({ code: 'CUSTOMER_REQUIRED' });
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, guestProductSales: true });
    const guest = await createSaleDraft(desk, { customerId: null });
    expect(guest.customerSnapshot.name).toBe('Guest');
    await expect(issueInvoice(desk, guest._id, { version: 0, payments: [] }, key())).rejects.toMatchObject({ code: 'EMPTY_BILL' });
    await discardDraft(desk, guest._id, { version: 0 });
    expect(await Invoice.countDocuments()).toBe(0);
  });
});

// ===========================================================================
describe('Refunds and returns', () => {
  it('front desk asks, the owner approves: money back, credit note, stock back on the shelf', async () => {
    await registerForGst();
    const bill = await sell([[serum, 2]]);
    const line = String(bill.lines[0]._id);

    const preview = await quoteRefund(desk, { invoiceId: bill._id, lines: [{ lineId: line, qty: 1, restock: 'SELLABLE' }] });
    expect(preview).toMatchObject({ creditTotal: 118000, cashRefund: 118000, dueReduced: 0 });

    const asked = await createRefund(desk, { invoiceId: bill._id, lines: [{ lineId: line, qty: 1, restock: 'SELLABLE' }], reason: 'Wrong size', method: 'UPI' }, key());
    expect(asked.refund.status).toBe('REQUESTED');
    expect(await inStore(serum)).toBe(8);
    expect((await Notification.find().lean()).map((n) => String(n.userId)).sort()).toEqual([owner.userId, andheriOwner.userId].sort());
    await expect(createRefund(desk, { invoiceId: bill._id, lines: [{ lineId: line, qty: 1, restock: 'SELLABLE' }], reason: 'Again' }, key())).rejects.toMatchObject({ code: 'REFUND_PENDING' });
    await expect(approveRefund(desk, asked.refund._id, {}, key())).rejects.toMatchObject({ status: 403 });

    const { refund, invoice } = await approveRefund(andheriOwner, asked.refund._id, {}, key());
    expect(refund).toMatchObject({ status: 'DONE', cashRefund: 118000, creditNoteNumber: `CN-AND/${FY}/001`, decidedByName: 'Meera' });
    expect(invoice).toMatchObject({ refundStatus: 'PARTIAL', creditedTotal: 118000, refundedTotal: 118000, balanceDue: 0, settlementStatus: 'PAID' });
    expect(invoice.lines[0]).toMatchObject({ refundedQty: 1, creditedTaxable: 100000, creditedCgst: 9000 });
    const note = await CreditNote.findById(refund.creditNoteId).lean();
    expect(note).toMatchObject({ invoiceNumber: bill.invoiceNumber, taxableTotal: 100000, cgstTotal: 9000, sgstTotal: 9000, total: 118000 });
    expect(note.lines[0]).toMatchObject({ name: 'Hair serum', code: '3305', qty: 1 });
    expect(await Payment.findOne({ kind: 'REFUND' }).lean()).toMatchObject({ method: 'UPI', amount: 118000, source: 'REFUND' });
    expect(await inStore(serum)).toBe(9);
    expect(await reconcile(owner)).toEqual([]);

    // The second unit takes exactly what's left; the line can't be refunded a third time
    const last = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: line, qty: 1, restock: 'DAMAGED' }], reason: 'Leaking' }, key());
    expect(last.refund.creditNoteNumber).toBe(`CN-AND/${FY}/002`);
    expect(last.invoice).toMatchObject({ refundStatus: 'FULL', creditedTotal: 236000, refundedTotal: 236000 });
    expect(await inStore(serum)).toBe(9); // damaged: came back and was written off
    expect(await InventoryTransaction.countDocuments({ type: 'WRITE_OFF', reason: 'DAMAGE' })).toBe(1);
    await expect(quoteRefund(owner, { invoiceId: bill._id, lines: [{ lineId: line, qty: 1, restock: 'SELLABLE' }] })).rejects.toMatchObject({ message: 'Only 0 of Hair serum can still be refunded' });
  });

  it('on a part-paid bill the refund first comes off what is owed', async () => {
    const bill = await sell([[serum, 1], [gel, 1]], { payments: [{ method: 'CASH', amount: 100000 }] }); // ₹1,680 bill, ₹1,000 paid
    const gelLine = String(lineOf(bill, 'Styling gel')._id);
    const { refund, invoice } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: gelLine, qty: 1, restock: 'SELLABLE' }], reason: 'Changed mind' }, key());
    expect(refund).toMatchObject({ creditTotal: 50000, cashRefund: 0, dueReduced: 50000, creditNoteId: null }); // no GST: no credit note
    expect(invoice).toMatchObject({ balanceDue: 18000, settlementStatus: 'PARTIALLY_PAID' });

    // Refunding the serum too: the customer gets back what they paid beyond the ₹0 left to pay
    const serumLine = String(lineOf(bill, 'Hair serum')._id);
    const second = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: serumLine, qty: 1, restock: 'SELLABLE' }], reason: 'Allergy' }, key());
    expect(second.refund).toMatchObject({ creditTotal: 118000, cashRefund: 100000, dueReduced: 18000 });
    expect(second.invoice).toMatchObject({ balanceDue: 0, refundStatus: 'FULL' });
  });

  it('refunding a service takes back its commission; used products are not returned', async () => {
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: today() });
    const bill = await checkout(desk, await completed());
    expect((await CommissionEntry.find().lean()).map((e) => e.amount)).toEqual([10000]);

    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1 }], reason: 'Unhappy with the cut' }, key());
    const rows = await CommissionEntry.find().sort('createdAt').lean();
    expect(rows.map((e) => [e.type, e.amount, e.saleAmount])).toEqual([['earned', 10000, 100000], ['reversal', -10000, -100000]]);
    expect(await InventoryTransaction.countDocuments({ type: 'SALE_RETURN' })).toBe(0);
    expect((await payroll.getCommission(owner, f.rahul._id, today().slice(0, 7))).totalAmount).toBe(0);
  });

  it('an owner can turn a request down (with a reason); branch owners can be stopped from approving', async () => {
    const bill = await sell([[gel, 1]]);
    const asked = await createRefund(desk, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1, restock: 'SELLABLE' }], reason: 'Not needed' }, key());
    await expect(rejectRefund(owner, asked.refund._id, { note: '' }, key())).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
    const { refund } = await rejectRefund(owner, asked.refund._id, { note: 'Opened tub' }, key());
    expect(refund).toMatchObject({ status: 'REJECTED', decisionNote: 'Opened tub' });
    expect(await inStore(gel)).toBe(1);

    await updateSettings(owner, { branchOwners: { approveRefunds: false } }, key());
    const again = await createRefund(andheriOwner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1, restock: 'SELLABLE' }], reason: 'Not needed' }, key());
    expect(again.refund.status).toBe('REQUESTED'); // she could only ask
    await expect(approveRefund(andheriOwner, again.refund._id, {}, key())).rejects.toMatchObject({ status: 403 });
  });
});

// ===========================================================================
describe('Voiding a bill', () => {
  it('owners void an unpaid bill: products go back, the appointment can be checked out again, the number stays used', async () => {
    const appt = await completed();
    let draft = await openDraft(desk, { appointmentId: appt._id });
    draft = await addProduct(desk, draft._id, { version: 0, skuId: String(gel._id), qty: 1 });
    const bill = await issueInvoice(desk, draft._id, { version: draft.version, payments: [] }, key());
    expect(await inStore(gel)).toBe(1);

    await expect(voidInvoice(desk, bill._id, { reason: 'Mistake' }, key())).rejects.toMatchObject({ status: 403 });
    const voided = await voidInvoice(owner, bill._id, { reason: 'Billed the wrong customer' }, key());
    expect(voided).toMatchObject({ status: 'VOID', voidReason: 'Billed the wrong customer', balanceDue: 0, invoiceNumber: `AND/${FY}/00001` });
    expect(await inStore(gel)).toBe(2);
    expect((await Appointment.findById(appt._id)).invoiceId).toBeNull();

    const again = await checkout(desk, appt);
    expect(again.invoiceNumber).toBe(`AND/${FY}/00002`);
    expect(await reconcile(owner)).toEqual([]);
  });

  it("can't void a bill with money on it", async () => {
    const bill = await checkout(desk, await completed(), { payments: [{ method: 'CASH', amount: 100 }] });
    await expect(voidInvoice(owner, bill._id, { reason: 'Mistake' }, key())).rejects.toMatchObject({ code: 'HAS_PAYMENTS' });
  });
});

// ===========================================================================
describe('Customer advances', () => {
  it('an advance is used at checkout, never beyond what is left or what is due', async () => {
    const taken = await takeAdvance(desk, { customerId: String(f.priya._id), method: 'UPI', amount: 60000, note: 'Bridal package deposit' }, key());
    expect(taken.balance).toBe(60000);

    const draft = await openDraft(desk, { appointmentId: (await completed())._id }); // ₹1,000
    await expect(issueInvoice(desk, draft._id, { version: 0, useAdvance: 70000, payments: [] }, key())).rejects.toMatchObject({ code: 'ADVANCE_TOO_LOW' });
    expect(draft.advanceBalance).toBe(60000);
    const bill = await issueInvoice(desk, draft._id, { version: 0, useAdvance: 60000, payments: [{ method: 'CASH', amount: 40000 }] }, key());
    expect(bill).toMatchObject({ settlementStatus: 'PAID', amountPaid: 100000, advanceBalance: 0 });
    expect(bill.payments.map((p) => [p.method, p.amount])).toEqual([['CASH', 40000], ['ADVANCE', 60000]]);

    const other = await openDraft(desk, { appointmentId: (await completed([[f.beardTrim, f.neha, 20000]]))._id });
    await expect(issueInvoice(desk, other._id, { version: 0, useAdvance: 100, payments: [] }, key())).rejects.toMatchObject({ code: 'ADVANCE_TOO_LOW' });
  });

  it('two bills using the same advance at the same moment can never use it twice', async () => {
    await takeAdvance(desk, { customerId: String(f.priya._id), method: 'CASH', amount: 100000 }, key());
    const [a, b] = await Promise.all([openDraft(desk, { appointmentId: (await completed())._id }), openDraft(owner, { appointmentId: (await completed())._id })]);
    const results = await Promise.allSettled([
      issueInvoice(desk, a._id, { version: 0, useAdvance: 100000, payments: [] }, key()),
      issueInvoice(owner, b._id, { version: 0, useAdvance: 100000, payments: [] }, key()),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect((await customerAdvances(owner, String(f.priya._id))).balance).toBe(0);
    expect(await PaymentAllocation.countDocuments({ advanceId: { $ne: null } })).toBe(1);
  });

  it('extra money at checkout can be kept as an advance instead of being refused', async () => {
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    await expect(issueInvoice(desk, draft._id, { version: 0, payments: [{ method: 'CASH', amount: 150000 }] }, key())).rejects.toMatchObject({ code: 'OVERPAID' });
    const bill = await issueInvoice(desk, draft._id, { version: 0, payments: [{ method: 'CASH', amount: 150000 }], keepExtraAsAdvance: true }, key());
    expect(bill).toMatchObject({ settlementStatus: 'PAID', amountPaid: 100000, advanceBalance: 50000 });
    const { advances } = await customerAdvances(owner, String(f.priya._id));
    expect(advances[0]).toMatchObject({ amount: 50000, remaining: 50000, note: `Extra paid on bill ${bill.invoiceNumber}` });
  });
});

// ===========================================================================
describe('Reversing a wrongly recorded payment', () => {
  it('owners only, with a reason: the amount is due again, commission comes back off and is earned again when paid', async () => {
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: today() });
    const bill = await checkout(desk, await completed(), { payments: [{ method: 'CARD', amount: 100000 }] });
    const paymentId = bill.payments[0]._id;

    await expect(reversePayment(desk, paymentId, { reason: 'Card declined' }, key())).rejects.toMatchObject({ status: 403 });
    const { invoice } = await reversePayment(owner, paymentId, { reason: 'Card was declined' }, key());
    expect(invoice).toMatchObject({ amountPaid: 0, balanceDue: 100000, settlementStatus: 'UNPAID' });
    expect(invoice.payments[0]).toMatchObject({ status: 'REVERSED', reversal: { reason: 'Card was declined', byName: 'Anita' } });
    expect((await CommissionEntry.find().lean()).reduce((sum, e) => sum + e.amount, 0)).toBe(0);
    await expect(reversePayment(owner, paymentId, { reason: 'Again' }, key())).rejects.toMatchObject({ code: 'ALREADY_REVERSED' });

    await recordPayments(desk, { invoiceId: bill._id, payments: [{ method: 'CASH', amount: 100000 }] }, key());
    const rows = await CommissionEntry.find().sort('createdAt').lean();
    expect(rows.map((e) => [e.type, e.amount, e.eventKey])).toEqual([['earned', 10000, 'paid:1'], ['reversal', -10000, `payment_reversed:${paymentId}`], ['earned', 10000, 'paid:2']]);
  });

  it("money already refunded can't be reversed away", async () => {
    const bill = await sell([[gel, 1]]);
    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1, restock: 'SELLABLE' }], reason: 'Returned' }, key());
    await expect(reversePayment(owner, bill.payments[0]._id, { reason: 'Oops' }, key())).rejects.toMatchObject({ code: 'ALREADY_REFUNDED' });
  });
});

// ===========================================================================
describe('Stock stays right after every kind of bill', () => {
  it('sales, returns, damaged returns and voids all match the movement history (AC24)', async () => {
    const one = await sell([[serum, 3], [gel, 1]]);
    await createRefund(owner, { invoiceId: one._id, lines: [{ lineId: String(lineOf(one, 'Hair serum')._id), qty: 2, restock: 'SELLABLE' }, { lineId: String(lineOf(one, 'Styling gel')._id), qty: 1, restock: 'DAMAGED' }], reason: 'Mixed' }, key());
    const two = await sell([[serum, 1]], { payments: [] });
    await voidInvoice(owner, two._id, { reason: 'Test' }, key());
    expect([await inStore(serum), await inStore(gel)]).toEqual([9, 1]);
    expect(await reconcile(owner)).toEqual([]);
    const sold = await InventoryLedgerEntry.aggregate([{ $match: { bucket: 'SOLD', skuId: new mongoose.Types.ObjectId(String(serum._id)) } }, { $group: { _id: null, qty: { $sum: '$qty' } } }]);
    expect(sold[0].qty).toBe(-1); // really sold: 3 + 1, minus 2 returned, minus 1 voided
  });
});

describe('Credit note numbers', () => {
  it('stay within 16 characters', () => {
    expect(formatCreditNoteNumber('AND', '26-27', 1)).toBe('CN-AND/26-27/001');
    expect(formatCreditNoteNumber('GLAM', '26-27', 12)).toBe('CNGLAM/26-27/012');
    expect(formatCreditNoteNumber('GLAM', '26-27', 999).length).toBeLessThanOrEqual(16);
  });
});

describe('Bill page permissions', () => {
  it('tells each person what they may do with an issued bill', async () => {
    const bill = await checkout(desk, await completed(), { payments: [] });
    expect((await getInvoice(desk, bill._id)).permissions).toMatchObject({ refund: 'request', void: false, reversePayments: false });
    expect((await getInvoice(andheriOwner, bill._id)).permissions).toMatchObject({ refund: 'approve', void: true, reversePayments: true });
    expect(mongoose.isValidObjectId(bill._id)).toBe(true);
  });
});
