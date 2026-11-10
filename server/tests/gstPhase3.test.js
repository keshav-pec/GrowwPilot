// GST Phase 3: advances for named services taxed when received, no double tax when used, limits and GSTIN checks,
// unused money given back. G numbers are from the GST PRD.
import { PassThrough } from 'node:stream';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import {
  Appointment, BillingSettings, CommissionEntry, Counter, CreditNote, Customer, CustomerAdvance, GstCheck, GstRegistration, GstTaxEntry, GstTaxRule, IdempotencyRecord, InventorySku, Invoice, Notification, Organization, Payment, PaymentAllocation, PayPlan, Refund, Service, User,
} from '../src/models/index.js';
import { formatVoucherNumber, gstinCheckChar } from '../src/config/billing.js';
import * as gst from '../src/modules/gst/gst.service.js';
import { advancesView, overview, salesRegister } from '../src/modules/gst/gst.record.js';
import { runTaxCheck } from '../src/modules/gst/gst.check.js';
import { advanceTaxPart } from '../src/modules/gst/gst.advances.js';
import { updateSettings } from '../src/modules/billing/settings.service.js';
import { runReport } from '../src/modules/billing/reports.service.js';
import { addProduct, createSaleDraft, getInvoice, issueInvoice, openDraft, quoteDraft } from '../src/modules/invoices/invoices.service.js';
import { createRefund } from '../src/modules/refunds/refunds.service.js';
import { customerAdvances, getAdvance, giveBackAdvance, quoteAdvance, recordPayments, reversePayment, takeAdvance } from '../src/modules/payments/payments.service.js';
import { writeAdvancePdf } from '../src/modules/payments/advance.pdf.js';
import { createSku } from '../src/modules/inventory/skus/skus.service.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

const GSTIN = (first14) => first14 + gstinCheckChar(first14);
const ANDHERI_GSTIN = GSTIN('27AAKCG4821M1Z');
const BANDRA_GSTIN = GSTIN('27AAKCG4821M2Z');
const INDIA = 'Asia/Kolkata';
const thisMonth = () => DateTime.now().setZone(INDIA).toFormat('yyyy-MM');
const org = () => new mongoose.Types.ObjectId(owner.orgId);

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
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita3@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram3@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya3@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  const base = { ...f.ctxGlamour, addons: ['inventory'], activeBranchId: String(f.andheri._id) };
  owner = { ...base, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  bandraOwner = { ...base, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
  desk = { ...base, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };
  shampoo = (await createSku(owner, { name: 'Shampoo', category: 'Retail', stockUnit: 'bottle', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 118000, openingQty: 500 }, key())).sku;
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all([BillingSettings, GstRegistration, GstTaxRule, GstTaxEntry, GstCheck, Appointment, Invoice, Counter, Payment, PaymentAllocation, Refund, CreditNote, IdempotencyRecord, CommissionEntry, PayPlan, Notification, CustomerAdvance].map((m) => m.deleteMany({})));
  await Service.updateMany({}, { $set: { taxRuleGroupId: null } });
  await InventorySku.updateMany({}, { $set: { taxRuleGroupId: null } });
  await Customer.updateMany({}, { $unset: { gstin: '', gstLegalName: '' } });
});

function completed(price = 105000, { service = f.haircut, staff = f.rahul, branch = f.andheri } = {}) {
  const at = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: branch._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: service._id, serviceName: service.name, staffId: staff._id, staffName: staff.name, startAt: at, endAt: at, durationMinutes: 30, price }],
    startAt: at, endAt: at, totalPrice: price, status: 'COMPLETED',
  });
}

async function active({ startMonth = thisMonth() } = {}) {
  await gst.saveSetup(owner, { scheme: 'REGULAR', startMonth }, key());
  await gst.addRegistration(owner, { gstin: ANDHERI_GSTIN, legalName: 'Glamour Pvt Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.andheri._id)] }, key());
  await gst.addRegistration(owner, { gstin: BANDRA_GSTIN, legalName: 'Glamour Pvt Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.bandra._id)] }, key());
  // Save added a rule for services and one for products, already linked: check them, then activate approves them
  const products = await GstTaxRule.findOne({ orgId: f.ctxGlamour.orgId, kind: 'PRODUCT' }).lean();
  await gst.updateRule(owner, String(products._id), { name: 'Hair products', code: '3305' }, key());
  await gst.activate(owner, key());
}

const named = (ctx, amount = 499900, extra = {}) => takeAdvance(ctx, { customerId: String(f.priya._id), method: 'UPI', amount, forServiceIds: [String(f.haircut._id), String(f.beardTrim._id)], ...extra }, key());
const plain = (ctx, amount = 200000) => takeAdvance(ctx, { customerId: String(f.priya._id), method: 'CASH', amount }, key());
const entries = (filter = {}) => GstTaxEntry.find({ orgId: owner.orgId, ...filter }).sort({ createdAt: 1 }).lean();
const theAdvance = () => CustomerAdvance.findOne({ orgId: owner.orgId, taxed: true }).lean();

// Checkout paying from the advance (and cash for any rest)
async function payFromAdvance(ctx, price, useAdvance, options = {}) {
  const draft = await openDraft(ctx, { appointmentId: (await completed(price, options))._id });
  const rest = price - useAdvance;
  return issueInvoice(ctx, draft._id, { version: draft.version, useAdvance, payments: rest > 0 ? [{ method: 'CASH', amount: rest }] : [] }, key());
}

// ===========================================================================
describe('Taking an advance for named services', () => {
  it('₹4,999 gives ₹4,760.95 + ₹238.05 tax, recorded once, with a numbered receipt voucher (G10)', async () => {
    await active();
    const k = key();
    const input = { customerId: String(f.priya._id), method: 'UPI', amount: 499900, forServiceIds: [String(f.haircut._id)], note: '5 haircuts, 5 trims, 5 spas' };
    await takeAdvance(desk, input, k);
    await takeAdvance(desk, input, k);
    await takeAdvance(desk, input, k);

    expect(await CustomerAdvance.countDocuments({ orgId: owner.orgId })).toBe(1);
    expect(await Payment.countDocuments({ source: 'ADVANCE' })).toBe(1);
    const advance = await theAdvance();
    expect(advance).toMatchObject({ taxed: true, amount: 499900, remaining: 499900 });
    expect(advance.receiptNumber).toMatch(new RegExp(`^RV-[A-Z0-9]+/${advance.financialYear}/001$`));
    expect(advance.gst).toMatchObject({ gstin: ANDHERI_GSTIN, code: '999721', rateBps: 500, itcType: 'WITHOUT_ITC', taxable: 476095, cgst: 11903, sgst: 11902, igst: 0, leftTaxable: 476095, leftCgst: 11903, customerName: 'Priya', placeOfSupply: { stateCode: '27', stateName: 'Maharashtra' } });

    const [entry, ...rest] = await entries();
    expect(rest).toEqual([]);
    expect(entry).toMatchObject({ type: 'ADVANCE_RECEIVED', documentNumber: advance.receiptNumber, gstin: ANDHERI_GSTIN, period: thisMonth(), taxable: 476095, cgst: 11903, sgst: 11902, tax: 23805, total: 499900, createdByName: 'Kavya' });
    expect(entry.invoiceId).toBeUndefined();
    expect(String(entry.advanceId)).toBe(String(advance._id));
  });

  it('the voucher prints as a PDF, numbers stay within 16 characters, and a quote saves nothing', async () => {
    await active();
    const quote = await quoteAdvance(desk, { amount: 499900, forServiceIds: [String(f.haircut._id)] });
    expect(quote).toMatchObject({ taxable: 476095, cgst: 11903, sgst: 11902, rateBps: 500, code: '999721' });
    expect(await CustomerAdvance.countDocuments()).toBe(0);

    for (const code of ['RV', 'RF', 'CN']) for (const prefix of ['A', 'ABC', 'ABCD']) expect(formatVoucherNumber(code, prefix, '26-27', 999).length).toBeLessThanOrEqual(16);
    expect(formatVoucherNumber('RV', 'AND', '26-27', 1)).toBe('RV-AND/26-27/001');

    await named(desk);
    const data = await getAdvance(desk, (await theAdvance())._id);
    const pdf = await new Promise((resolve) => {
      const out = new PassThrough();
      const chunks = [];
      out.on('data', (c) => chunks.push(c));
      out.on('end', () => resolve(Buffer.concat(chunks)));
      writeAdvancePdf(out, data);
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('nobody chooses the rate: it comes from the services’ approved rule', async () => {
    await active();
    await Service.updateOne({ _id: f.beardTrim._id }, { $set: { taxRuleGroupId: null } });
    await expect(named(desk)).rejects.toMatchObject({ code: 'TAX_CLASSIFICATION_MISSING', details: { blockers: [expect.objectContaining({ link: `/app/catalog?service=${f.beardTrim._id}` })] } });
    expect(await CustomerAdvance.countDocuments()).toBe(0);
    expect(await Payment.countDocuments()).toBe(0);
  });

  it('services under different rules need separate advances', async () => {
    await active();
    const { ruleId } = await gst.createRule(owner, { name: 'Beauty', kind: 'SERVICE', code: '999722', rateBps: 1800, itcType: 'WITH_ITC', from: '2025-09-22' }, key());
    await gst.approveRule(owner, ruleId, { reviewedBy: 'CA Mehta' }, key());
    await Service.updateOne({ _id: f.beardTrim._id }, { $set: { taxRuleGroupId: (await GstTaxRule.findById(ruleId).lean()).groupId } });
    await expect(named(desk)).rejects.toMatchObject({ code: 'ADVANCE_MIXED_RULES' });
  });

  it('a service from another salon isn’t found', async () => {
    await active();
    await expect(named(desk, 100000, { forServiceIds: [String(f.dubaiHaircut._id)] })).rejects.toMatchObject({ status: 404 });
  });

  it('needs GST setup to be active; a plain advance doesn’t', async () => {
    await expect(named(desk)).rejects.toMatchObject({ code: 'GST_NOT_ACTIVE' });
    await plain(desk);
    expect(await CustomerAdvance.countDocuments({ orgId: owner.orgId, taxed: false })).toBe(1);
    expect(await GstTaxEntry.countDocuments()).toBe(0);
  });

  it('money for a bill already issued gets no advance tax: that bill already has it (G11)', async () => {
    await active();
    const bill = await checkout(desk, await completed(), { payments: [] });
    await expect(named(desk, 105000, { billId: String(bill._id) })).rejects.toMatchObject({ code: 'ADVANCE_ALREADY_TAXED' });
    expect(await CustomerAdvance.countDocuments()).toBe(0);
    expect(await GstTaxEntry.countDocuments({ type: 'ADVANCE_RECEIVED' })).toBe(0);
  });

  it('a business customer’s GSTIN goes on the voucher and the record', async () => {
    await active();
    await Customer.updateOne({ _id: f.priya._id }, { $set: { gstin: GSTIN('29AABCT3518Q1Z'), gstLegalName: 'Priya Beauty LLP' } });
    await named(desk);
    expect((await theAdvance()).gst.buyer).toMatchObject({ legalName: 'Priya Beauty LLP' });
    expect((await entries())[0].buyer).toMatchObject({ legalName: 'Priya Beauty LLP' });
  });

  it('a start month ahead of today: taxed and numbered, but out of the record, and so is using it', async () => {
    await active({ startMonth: DateTime.now().setZone(INDIA).plus({ months: 1 }).toFormat('yyyy-MM') });
    await named(desk);
    await payFromAdvance(desk, 105000, 105000);
    expect(await GstTaxEntry.countDocuments()).toBe(0);
    expect((await theAdvance()).remaining).toBe(394900);
  });
});

// ===========================================================================
describe('Plain advances and extra money stay untaxed (decision 5)', () => {
  it('a plain advance adds no tax when taken or used; only the bill is taxed', async () => {
    await active();
    await plain(desk, 200000);
    expect(await GstTaxEntry.countDocuments()).toBe(0);
    const bill = await payFromAdvance(desk, 105000, 105000);
    expect(bill).toMatchObject({ balanceDue: 0, cgstTotal: 2500 });
    expect((await entries()).map((e) => e.type)).toEqual(['BILL_ISSUED']);
    const [allocation] = await PaymentAllocation.find({ invoiceId: bill._id }).lean();
    expect(allocation.advanceTax?.cgst).toBeUndefined();
  });

  it('extra money kept at checkout stays untaxed', async () => {
    await active();
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    await issueInvoice(desk, draft._id, { version: draft.version, keepExtraAsAdvance: true, payments: [{ method: 'CASH', amount: 200000 }] }, key());
    const advance = await CustomerAdvance.findOne({ orgId: owner.orgId }).lean();
    expect(advance).toMatchObject({ taxed: false, amount: 95000 });
    expect((await entries()).map((e) => e.type)).toEqual(['BILL_ISSUED']);
  });

  it('plain advances pay bills at any branch, as today', async () => {
    await active();
    await plain(desk, 200000);
    const bill = await payFromAdvance(owner, 120000, 120000, { service: f.facial, staff: f.arjun, branch: f.bandra });
    expect(bill.balanceDue).toBe(0);
  });
});

// ===========================================================================
describe('Using a taxed advance on a later bill', () => {
  it('adds no second tax, and ₹0 is due (G12)', async () => {
    await active();
    await named(desk);
    const bill = await payFromAdvance(desk, 105000, 105000);
    expect(bill).toMatchObject({ grandTotal: 105000, balanceDue: 0, settlementStatus: 'PAID', cgstTotal: 2500, sgstTotal: 2500 });

    const [received, issued, used] = await entries();
    expect([received.type, issued.type, used.type]).toEqual(['ADVANCE_RECEIVED', 'BILL_ISSUED', 'ADVANCE_USED']);
    expect(issued).toMatchObject({ taxable: 100000, tax: 5000 });
    expect(used).toMatchObject({ documentNumber: bill.invoiceNumber, gstin: ANDHERI_GSTIN, taxable: -100000, cgst: -2500, sgst: -2500, tax: -5000, total: -105000, originalEntryId: received._id });
    expect(String(used.invoiceId)).toBe(String(bill._id));

    // The month's tax is still just the tax on the advance
    expect((await overview(owner, {})).net).toMatchObject({ taxable: 476095, cgst: 11903, sgst: 11902, tax: 23805 });

    const advance = await theAdvance();
    expect(advance).toMatchObject({ remaining: 394900 });
    expect(advance.gst).toMatchObject({ taxable: 476095, leftTaxable: 376095, leftCgst: 9403, leftSgst: 9402 });
    // The bill says the tax was already paid, and which voucher
    const shown = (await getInvoice(desk, bill._id)).payments[0];
    expect(shown).toMatchObject({ kind: 'ADVANCE', amount: 105000, reference: advance.receiptNumber, taxAlreadyPaid: 5000 });
  });

  it('tax is added only on the extra amount', async () => {
    await active();
    await named(desk);
    const bill = await payFromAdvance(desk, 600000, 499900);
    expect(bill).toMatchObject({ grandTotal: 600000, balanceDue: 0, taxTotal: 28571 });
    expect((await overview(owner, {})).net).toMatchObject({ tax: 28571, total: 600000 }); // not 28,571 + 23,805
    expect((await theAdvance()).gst).toMatchObject({ leftTaxable: 0, leftCgst: 0, leftSgst: 0, leftIgst: 0 });
  });

  it('works from Record payment too, and the stylist’s commission is unaffected', async () => {
    await active();
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: DateTime.now().setZone(INDIA).toISODate() });
    await named(desk);
    const bill = await checkout(desk, await completed(), { payments: [] });
    await recordPayments(desk, { invoiceId: bill._id, payments: [], useAdvance: 105000 }, key());
    expect((await entries({ type: 'ADVANCE_USED' }))[0]).toMatchObject({ tax: -5000 });
    expect((await CommissionEntry.find({ invoiceId: bill._id }).lean()).reduce((t, r) => t + r.amount, 0)).toBe(10000);
  });

  it('using more than is left is refused and earlier records stay unchanged (G13)', async () => {
    await active();
    await named(desk, 100000);
    await payFromAdvance(desk, 60000, 60000);
    const before = { advance: await theAdvance(), entries: await entries(), allocations: await PaymentAllocation.countDocuments() };

    const draft = await openDraft(desk, { appointmentId: (await completed(105000))._id });
    await expect(issueInvoice(desk, draft._id, { version: draft.version, useAdvance: 50000, payments: [{ method: 'CASH', amount: 55000 }] }, key())).rejects.toMatchObject({ code: 'ADVANCE_TOO_LOW' });

    expect(await theAdvance()).toEqual(before.advance);
    expect(await entries()).toEqual(before.entries);
    expect(await PaymentAllocation.countDocuments()).toBe(before.allocations);
    expect((await Invoice.findById(draft._id).lean()).status).toBe('DRAFT');
  });

  it('the tax used can never exceed the tax paid, whatever the rounding', async () => {
    await active();
    await named(desk, 100000);
    for (const amount of [33333, 33333, 33334]) await payFromAdvance(desk, amount, amount);
    const uses = await PaymentAllocation.find({ advanceId: (await theAdvance())._id }).lean();
    const sum = (field) => uses.reduce((t, u) => t + u.advanceTax[field], 0);
    const { gst: g } = await theAdvance();
    expect(sum('cgst')).toBe(g.cgst);
    expect(sum('sgst')).toBe(g.sgst);
    expect(sum('taxable')).toBe(g.taxable);
    expect(g).toMatchObject({ leftTaxable: 0, leftCgst: 0, leftSgst: 0 });
    expect(() => advanceTaxPart({ amount: 100000, gst: g }, 1)).toThrow();
  });

  it('two desks using the same money at once: one wins, and the tax follows only that one', async () => {
    await active();
    await named(desk, 105000);
    const drafts = [await openDraft(desk, { appointmentId: (await completed())._id }), await openDraft(desk, { appointmentId: (await completed())._id })];
    const go = (d) => issueInvoice(desk, d._id, { version: d.version, useAdvance: 105000, payments: [] }, key());
    const results = await Promise.allSettled(drafts.map(go));
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await GstTaxEntry.countDocuments({ type: 'ADVANCE_USED' })).toBe(1);
    expect(await theAdvance()).toMatchObject({ remaining: 0 });
  });

  it('a refund on a bill paid from the advance nets out correctly', async () => {
    await active();
    await named(desk);
    const bill = await payFromAdvance(desk, 105000, 105000);
    await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1 }], reason: 'Unhappy' }, key());
    // ₹1,050 went back, so ₹3,949 is left with the salon: its tax is ₹238.05 - ₹50
    expect((await overview(owner, {})).net).toMatchObject({ tax: 18805, total: 394900 });
  });
});

// ===========================================================================
describe('A taxed advance stays under its GSTIN', () => {
  it('is refused at a branch on another GSTIN; the screen shows what can and can’t be used', async () => {
    await active();
    await named(desk);
    const draft = await openDraft(owner, { appointmentId: (await completed(120000, { service: f.facial, staff: f.arjun, branch: f.bandra }))._id });
    const shown = await quoteDraft(owner, draft._id, {});
    expect(shown).toMatchObject({ advanceBalance: 0, advanceElsewhere: 499900 });
    await expect(issueInvoice(owner, draft._id, { version: draft.version, useAdvance: 120000, payments: [] }, key())).rejects.toMatchObject({ code: 'ADVANCE_OTHER_GSTIN' });
    expect(await theAdvance()).toMatchObject({ remaining: 499900 });
    expect(await GstTaxEntry.countDocuments({ type: 'ADVANCE_USED' })).toBe(0);
    // At its own GSTIN it is all there
    const home = await openDraft(desk, { appointmentId: (await completed())._id });
    expect(await quoteDraft(desk, home._id, {})).toMatchObject({ advanceBalance: 499900, advanceElsewhere: 0 });
  });

  it('a plain advance fills in where a taxed one can’t go', async () => {
    await active();
    await named(desk);
    await plain(desk, 200000);
    const bill = await payFromAdvance(owner, 120000, 120000, { service: f.facial, staff: f.arjun, branch: f.bandra });
    expect(bill.balanceDue).toBe(0);
    expect(await theAdvance()).toMatchObject({ remaining: 499900 });
    const draft = await openDraft(owner, { appointmentId: (await completed(120000, { service: f.facial, staff: f.arjun, branch: f.bandra }))._id });
    expect(await quoteDraft(owner, draft._id, {})).toMatchObject({ advanceBalance: 80000, advanceElsewhere: 499900 });
  });

  it('is refused on a bill with another place of supply, because IGST can’t use up CGST and SGST', async () => {
    await active();
    await named(desk);
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    await expect(issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', useAdvance: 105000, payments: [] }, key())).rejects.toMatchObject({ code: 'ADVANCE_OTHER_GSTIN' });
    expect((await Invoice.findById(draft._id).lean()).status).toBe('DRAFT');
    const quote = await quoteDraft(owner, draft._id, { placeOfSupply: '29' });
    expect(quote.interstate).toBe(true);
  });
});

// ===========================================================================
describe('Giving back unused money', () => {
  it('adds a linked minus entry and a refund voucher; the original stays, and the money leaves the drawer', async () => {
    await active();
    await named(desk);
    const advance = await theAdvance();
    const [received] = await entries();
    const k = key();
    const input = { amount: 105000, method: 'CASH', reason: 'Moved to another city' };
    await giveBackAdvance(owner, advance._id, input, k);
    await giveBackAdvance(owner, advance._id, input, k);

    const after = await theAdvance();
    expect(after).toMatchObject({ remaining: 394900, givenBack: 105000 });
    expect(after.refunds).toHaveLength(1);
    expect(after.refunds[0]).toMatchObject({ amount: 105000, cgst: 2500, sgst: 2500, taxable: 100000, byName: 'Anita', reason: 'Moved to another city' });
    expect(after.refunds[0].number).toMatch(/^RF-/);

    const all = await entries();
    expect(all).toHaveLength(2);
    expect(all[0]).toEqual(received);
    expect(all[1]).toMatchObject({ type: 'ADVANCE_REFUNDED', documentNumber: after.refunds[0].number, taxable: -100000, cgst: -2500, sgst: -2500, total: -105000, originalEntryId: received._id });

    expect(await Payment.find({ kind: 'REFUND', advanceId: advance._id }).lean()).toHaveLength(1);
    const collections = await runReport(owner, 'collections', {});
    expect(collections.totals).toMatchObject({ refunded: 105000 });
    expect((await overview(owner, {})).net).toMatchObject({ tax: 18805, total: 394900 });
    expect((await overview(owner, {})).collected).toBe(394900);
    expect((await runReport(owner, 'advances', {})).totals).toMatchObject({ taken: 499900, givenBack: 105000 });
  });

  it('can’t give back more than is left, and all that is left takes all the tax left', async () => {
    await active();
    await named(desk, 100000);
    await payFromAdvance(desk, 33333, 33333);
    const advance = await theAdvance();
    await expect(giveBackAdvance(owner, advance._id, { amount: 66668, method: 'CASH', reason: 'Too much' }, key())).rejects.toMatchObject({ code: 'ADVANCE_TOO_LOW' });
    await giveBackAdvance(owner, advance._id, { amount: 66667, method: 'CASH', reason: 'All the rest' }, key());
    expect((await theAdvance()).gst).toMatchObject({ leftTaxable: 0, leftCgst: 0, leftSgst: 0, leftIgst: 0 });
    expect((await overview(owner, {})).net).toMatchObject({ total: 33333 });
  });

  it('a plain advance can be given back too: money only, no voucher, nothing in the record', async () => {
    await plain(desk, 200000);
    const advance = await CustomerAdvance.findOne({ orgId: owner.orgId }).lean();
    const seen = await giveBackAdvance(owner, advance._id, { amount: 200000, method: 'CASH', reason: 'Changed plans' }, key());
    expect(seen.balance).toBe(0);
    expect(seen.advances[0].refunds[0].number).toBeUndefined();
    expect(await GstTaxEntry.countDocuments()).toBe(0);
  });

  it('only those who may approve refunds can do it, at their own branches', async () => {
    await active();
    await named(desk);
    const advance = await theAdvance();
    const input = { amount: 1000, method: 'CASH', reason: 'Testing' };
    await expect(giveBackAdvance(desk, advance._id, input, key())).rejects.toMatchObject({ status: 403 });
    await expect(giveBackAdvance(bandraOwner, advance._id, input, key())).rejects.toMatchObject({ status: 404 });
    await updateSettings(owner, { branchOwners: { approveRefunds: false } }, key());
    await expect(giveBackAdvance(bandraOwner, advance._id, input, key())).rejects.toMatchObject({ status: 403 });
    const other = { ...f.ctxDesert, userName: 'Fatima', role: 'OWNER', isPrimaryOwner: true };
    await expect(giveBackAdvance(other, advance._id, input, key())).rejects.toMatchObject({ status: 404 });
    expect((await theAdvance()).remaining).toBe(499900);
  });

  it('reversing the payment of an unused advance adds a minus entry; a used one can’t be reversed', async () => {
    await active();
    await named(desk);
    const advance = await theAdvance();
    const paymentId = advance.sources[0].paymentId;
    await reversePayment(owner, paymentId, { reason: 'Card declined' }, key());
    expect(await theAdvance()).toMatchObject({ remaining: 0, gst: { leftTaxable: 0, leftCgst: 0 } });
    expect((await theAdvance()).reversedAt).toBeTruthy();
    const all = await entries();
    expect(all.map((e) => e.type)).toEqual(['ADVANCE_RECEIVED', 'ADVANCE_REVERSED']);
    expect(all[1]).toMatchObject({ taxable: -476095, tax: -23805, total: -499900, originalEntryId: all[0]._id });
    expect((await overview(owner, {})).net).toMatchObject({ tax: 0, total: 0 });

    await CustomerAdvance.deleteMany({});
    await named(desk);
    const second = await theAdvance();
    await payFromAdvance(desk, 105000, 105000);
    await expect(reversePayment(owner, second.sources[0].paymentId, { reason: 'Oops' }, key())).rejects.toMatchObject({ code: 'ADVANCE_USED' });
  });
});

// ===========================================================================
describe('The November test', () => {
  it('haircut + package + product: ₹7,229 collected, ₹6,760.95 taxable and ₹468.05 tax, each its own measure', async () => {
    await active();
    await checkout(desk, await completed(105000), { payments: [{ method: 'CASH', amount: 105000 }] });
    await named(desk, 499900);
    let sale = await createSaleDraft(desk, { customerId: String(f.priya._id) });
    sale = await addProduct(desk, sale._id, { version: sale.version, skuId: String(shampoo._id), qty: 1 });
    await issueInvoice(desk, sale._id, { version: sale.version, payments: [{ method: 'CARD', amount: 118000 }] }, key());

    const month = await overview(owner, {});
    expect(month.collected).toBe(722900);
    expect(month.net.taxable).toBe(676095);
    expect(month.net.tax).toBe(46805);
    expect(month.net).toMatchObject({ cgst: 11903 + 2500 + 9000, sgst: 11902 + 2500 + 9000, igst: 0 });
    expect(month.advanceTaken).toMatchObject({ count: 1, tax: 23805 });
    expect(month.bills).toMatchObject({ count: 2, tax: 23000 });

    const report = await runReport(owner, 'gst', {});
    expect(report.totals).toMatchObject({ netTaxable: 676095 });
    expect(report.totals.netCgst + report.totals.netSgst).toBe(46805);
    expect((await runTaxCheck(org())).differences).toEqual([]);
  });
});

// ===========================================================================
describe('The nightly check covers advances', () => {
  it('everything taken, used, given back and reversed matches', async () => {
    await active();
    await named(desk);
    await payFromAdvance(desk, 105000, 105000);
    await giveBackAdvance(owner, (await theAdvance())._id, { amount: 10000, method: 'CASH', reason: 'Part back' }, key());
    const second = await takeAdvance(desk, { customerId: String(f.priya._id), method: 'CASH', amount: 50000, forServiceIds: [String(f.haircut._id)] }, key());
    await reversePayment(owner, second.advances[0].sources[0].paymentId, { reason: 'Mistake' }, key());
    const result = await runTaxCheck(org());
    expect(result.differences).toEqual([]);
    expect(result.checked).toBe(3); // the bill and two advances
  });

  it('finds a missing entry for an advance or a use, and links to the voucher or bill', async () => {
    await active();
    await named(desk);
    const bill = await payFromAdvance(desk, 105000, 105000);
    await GstTaxEntry.deleteOne({ type: 'ADVANCE_USED' });
    const { differences } = await runTaxCheck(org());
    expect(differences).toHaveLength(1);
    expect(differences[0]).toMatchObject({ code: 'ENTRY_MISSING', link: `/app/invoices/${bill._id}` });
    expect(await Notification.countDocuments({ link: '/app/gst' })).toBe(1);
  });

  it('finds an advance that doesn’t add up', async () => {
    await active();
    await named(desk);
    await CustomerAdvance.updateOne({ taxed: true }, { $inc: { remaining: -100 } });
    const { differences } = await runTaxCheck(org());
    const advance = await theAdvance();
    expect(differences.map((d) => d.code)).toEqual(['ADVANCE_DOES_NOT_ADD_UP']);
    expect(differences[0].link).toBe(`/app/advances/${advance._id}`);
  });
});

// ===========================================================================
describe('Register and advances view', () => {
  it('the register lists advances; a row opens its voucher, or the bill it was used on', async () => {
    await active();
    await named(desk);
    const bill = await payFromAdvance(desk, 105000, 105000);
    const advance = await theAdvance();
    const { rows, totals } = await salesRegister(owner, {});
    const of = (type) => rows.find((r) => r.type === type);
    expect(of('Advance taken')).toMatchObject({ documentNumber: advance.receiptNumber, link: `/app/advances/${advance._id}`, taxable: 476095 });
    expect(of('Advance used')).toMatchObject({ documentNumber: bill.invoiceNumber, link: `/app/invoices/${bill._id}`, taxable: -100000 });
    expect(of('Bill').link).toBe(`/app/invoices/${bill._id}`);
    expect(totals).toMatchObject({ taxable: 476095, tax: 23805 });
    expect((await salesRegister(owner, { type: 'ADVANCE_USED' })).total).toBe(1);
  });

  it('shows taken, used and left, with tax, for each GSTIN, with plain advances as one figure', async () => {
    await active();
    await named(desk);
    await payFromAdvance(desk, 105000, 105000);
    await giveBackAdvance(owner, (await theAdvance())._id, { amount: 10000, method: 'CASH', reason: 'Part back' }, key());
    await plain(desk, 200000);
    const bandraDesk = { ...owner, activeBranchId: String(f.bandra._id) };
    await takeAdvance(bandraDesk, { customerId: String(f.priya._id), method: 'CASH', amount: 105000, forServiceIds: [String(f.facial._id)] }, key());

    const view = await advancesView(owner, {});
    expect(view.rows).toHaveLength(2);
    expect(view.plainLeft).toBe(200000);
    const andheri = view.byGstin.find((g) => g.gstin === ANDHERI_GSTIN);
    expect(andheri).toMatchObject({ taken: 499900, used: 105000, givenBack: 10000, left: 384900, taxTaken: 23805 });
    expect(andheri.taxUsed + andheri.taxLeft).toBe(23805);
    expect(view.byGstin.find((g) => g.gstin === BANDRA_GSTIN)).toMatchObject({ taken: 105000, left: 105000, taxUsed: 0 });
    expect((await advancesView(owner, { gstin: BANDRA_GSTIN })).rows).toHaveLength(1);
  });

  it('can show only those with money left', async () => {
    await active();
    await named(desk, 105000);
    await payFromAdvance(desk, 105000, 105000);
    expect((await advancesView(owner, {})).rows).toHaveLength(1);
    expect((await advancesView(owner, { open: true })).rows).toHaveLength(0);
  });

  it('branch owners need the switch, then see their own branches; other salons see nothing', async () => {
    await active();
    await named(desk);
    await expect(advancesView(bandraOwner, {})).rejects.toMatchObject({ status: 403 });
    await updateSettings(owner, { branchOwners: { viewGst: true } }, key());
    expect((await advancesView(bandraOwner, {})).rows).toHaveLength(0);
    const other = { ...f.ctxDesert, userName: 'Fatima', role: 'OWNER', isPrimaryOwner: true };
    expect((await advancesView(other, {})).rows).toHaveLength(0);
    await expect(getAdvance(other, (await theAdvance())._id)).rejects.toMatchObject({ status: 404 });
  });

  it('the customer’s advances show the voucher, its tax and whether they can be given back', async () => {
    await active();
    await named(desk);
    const forDesk = await customerAdvances(desk, f.priya._id);
    expect(forDesk).toMatchObject({ namedAllowed: true, canGiveBack: false, balance: 499900 });
    expect(forDesk.advances[0]).toMatchObject({ taxed: true, gst: { cgst: 11903 } });
    expect((await customerAdvances(owner, f.priya._id)).canGiveBack).toBe(true);
  });
});

// Through the real API
describe('Advances through the API', () => {
  const PASSWORD = 'Password@123';
  let server;
  let api;
  const cookies = {};
  const call = async (who, method, path, body) => {
    const headers = { 'content-type': 'application/json', 'idempotency-key': `test-${new mongoose.Types.ObjectId()}` };
    if (who) headers.cookie = cookies[who];
    const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, type, json: type.includes('json') ? await res.json() : null, size: type.includes('pdf') ? (await res.arrayBuffer()).byteLength : 0 };
  };

  beforeAll(async () => {
    const g = f.ctxGlamour.orgId;
    await Organization.updateOne({ _id: g }, { $set: { 'addons.inventory.enabled': true } });
    const passwordHash = await hashPassword(PASSWORD);
    await User.create([
      { orgId: g, role: 'OWNER', name: 'Biz', email: 'biz3@g.com', passwordHash, allBranches: true },
      { orgId: g, role: 'FRONT_DESK', name: 'Desk', email: 'desk3@g.com', passwordHash, branchIds: [f.andheri._id] },
      { orgId: g, role: 'INVENTORY', name: 'Stock', email: 'stock3@g.com', passwordHash, branchIds: [f.andheri._id] },
    ]);
    server = app.listen(0);
    api = `http://127.0.0.1:${server.address().port}/api`;
    for (const [who, email] of Object.entries({ business: 'biz3@g.com', desk: 'desk3@g.com', stock: 'stock3@g.com' })) {
      const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      cookies[who] = res.headers.get('set-cookie')?.split(';')[0];
    }
  });
  afterAll(() => server?.close());

  it('the desk takes it and gets the voucher; only an owner gives it back; inventory logins are refused', async () => {
    await active();
    const body = { customerId: String(f.priya._id), method: 'UPI', amount: 499900, forServiceIds: [String(f.haircut._id)] };
    expect((await call('stock', 'POST', '/advances', body)).status).toBe(403);
    expect((await call('desk', 'POST', '/advances/quote', { amount: 499900, forServiceIds: [String(f.haircut._id)] })).json).toMatchObject({ cgst: 11903 });
    const taken = await call('desk', 'POST', '/advances', body);
    expect(taken.status).toBe(201);
    const id = taken.json.advances[0]._id;

    const voucher = await call('desk', 'GET', `/advances/${id}`);
    expect(voucher.json.advance.receiptNumber).toMatch(/^RV-/);
    const pdf = await call('desk', 'GET', `/advances/${id}/pdf`);
    expect(pdf.type).toContain('pdf');
    expect(pdf.size).toBeGreaterThan(500);
    expect((await call('stock', 'GET', `/advances/${id}`)).status).toBe(403);

    const back = { amount: 1000, method: 'CASH', reason: 'Testing it' };
    expect((await call('desk', 'POST', `/advances/${id}/give-back`, back)).status).toBe(403);
    expect((await call('business', 'POST', `/advances/${id}/give-back`, { ...back, reason: 'x' })).status).toBe(400);
    expect((await call('business', 'POST', `/advances/${id}/give-back`, back)).status).toBe(200);

    expect((await call('business', 'GET', '/gst/advances')).status).toBe(200);
    expect((await call('desk', 'GET', '/gst/advances')).status).toBe(403);
    expect((await call('stock', 'GET', '/gst/advances')).status).toBe(403);
    expect((await call(null, 'GET', '/gst/advances')).status).toBe(401);
  });
});
