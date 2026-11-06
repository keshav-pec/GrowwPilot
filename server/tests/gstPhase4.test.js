// GST Phase 4: GSTR-1 from preparation to recorded filing. G numbers are from the GST PRD.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import {
  ActivityLog, Appointment, BillingSettings, CommissionEntry, Counter, CreditNote, Customer, CustomerAdvance, GstAdjustment, GstCheck, GstRegistration, GstReturn, GstTaxEntry, GstTaxRule, IdempotencyRecord, InventorySku, Invoice, Notification, Organization, Payment, PaymentAllocation, PayPlan, Refund, Service, User,
} from '../src/models/index.js';
import { gstinCheckChar } from '../src/config/billing.js';
import * as gst from '../src/modules/gst/gst.service.js';
import * as gstr1 from '../src/modules/gst/gstr1.service.js';
import { checkFormat, toPortalFile, GSTR1_FORMAT } from '../src/modules/gst/gstr1.format.js';
import { buildGstr1, rulesFor } from '../src/modules/gst/gstr1.rules.js';
import { reviewCsv } from '../src/modules/gst/gstr1.review.js';
import { runTaxCheck } from '../src/modules/gst/gst.check.js';
import { updateSettings } from '../src/modules/billing/settings.service.js';
import { addProduct, createSaleDraft, getInvoice, issueInvoice, openDraft, voidInvoice } from '../src/modules/invoices/invoices.service.js';
import { createRefund } from '../src/modules/refunds/refunds.service.js';
import { giveBackAdvance, takeAdvance } from '../src/modules/payments/payments.service.js';
import { createSku } from '../src/modules/inventory/skus/skus.service.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

const GSTIN = (first14) => first14 + gstinCheckChar(first14);
const ANDHERI_GSTIN = GSTIN('27AAKCG4821M1Z');
const BANDRA_GSTIN = GSTIN('27AAKCG4821M2Z');
const BUYER_GSTIN = GSTIN('29AABCT3518Q1Z');
const INDIA = 'Asia/Kolkata';
const thisMonth = () => DateTime.now().setZone(INDIA).toFormat('yyyy-MM');
const ARN = 'AA270426123456A';
const proof = { originalname: 'ack.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ack') };
const filing = { arn: ARN, filedOn: DateTime.now().setZone(INDIA).toISODate() };

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
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita4@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram4@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya4@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  const base = { ...f.ctxGlamour, addons: ['inventory'], activeBranchId: String(f.andheri._id) };
  owner = { ...base, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  bandraOwner = { ...base, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
  desk = { ...base, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };
  shampoo = (await createSku(owner, { name: 'Shampoo', category: 'Retail', stockUnit: 'bottle', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 118000, openingQty: 500 }, key())).sku;
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all([BillingSettings, GstRegistration, GstTaxRule, GstTaxEntry, GstCheck, GstReturn, GstAdjustment, Appointment, Invoice, Counter, Payment, PaymentAllocation, Refund, CreditNote, IdempotencyRecord, CommissionEntry, PayPlan, Notification, CustomerAdvance].map((m) => m.deleteMany({})));
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

async function active() {
  await gst.saveSetup(owner, { scheme: 'REGULAR', startMonth: thisMonth() }, key());
  await gst.addRegistration(owner, { gstin: ANDHERI_GSTIN, legalName: 'Glamour Pvt Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.andheri._id)] }, key());
  await gst.addRegistration(owner, { gstin: BANDRA_GSTIN, legalName: 'Glamour Pvt Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.bandra._id)] }, key());
  const rule = await GstTaxRule.findOne({ orgId: f.ctxGlamour.orgId }).lean();
  await gst.approveRule(owner, String(rule._id), { reviewedBy: 'CA Mehta' }, key());
  await gst.linkUnlinked(owner, String(rule.groupId), key());
  const { ruleId } = await gst.createRule(owner, { name: 'Hair products', kind: 'PRODUCT', code: '330510', rateBps: 1800, itcType: 'WITH_ITC', from: '2025-09-22' }, key());
  await gst.approveRule(owner, ruleId, { reviewedBy: 'CA Mehta' }, key());
  await gst.linkUnlinked(owner, String((await GstTaxRule.findById(ruleId).lean()).groupId), key());
  await gst.testBill(owner, { branchId: String(f.andheri._id), lines: [{ groupId: String(rule.groupId), unitPrice: 105000, qty: 1 }] });
  await gst.activate(owner, key());
}

const bill = async (price = 105000, options = {}, ctx = owner) => checkout(ctx, await completed(price, options));
async function productSale(qty = 1) {
  let draft = await createSaleDraft(owner, { customerId: String(f.priya._id) });
  draft = await addProduct(owner, draft._id, { version: draft.version, skuId: String(shampoo._id), qty });
  return issueInvoice(owner, draft._id, { version: draft.version, payments: [{ method: 'CASH', amount: draft.grandTotal }] }, key());
}
const prepare = (gstin = ANDHERI_GSTIN, period = thisMonth(), ctx = owner) => gstr1.prepareReturn(ctx, { gstin, period }, key());
const load = (id) => GstReturn.findById(id).lean();
const setUnits = () => gstr1.saveUnitCodes(owner, { units: { bottle: 'BTL' } }, key());
async function throughExport() {
  const { returnId } = await prepare();
  await gstr1.approveReturn(owner, returnId, key());
  const exported = await gstr1.exportReturn(owner, returnId);
  return { returnId, exported };
}
async function filedMonth() {
  const made = await throughExport();
  await gstr1.recordFiling(owner, made.returnId, filing, proof, key());
  return made;
}

// ===========================================================================
describe('The tables', () => {
  it('a consumer haircut goes to B2C others and Table 12 B2C as a service; the document is counted (G18, G19, G20)', async () => {
    await active();
    const b = await bill();
    const { returnId, status } = await prepare();
    expect(status).toBe('READY');
    const r = await load(returnId);
    expect(r.tables.b2cs).toEqual([{ pos: '27', rateBps: 500, supply: 'INTRA', taxable: 100000, cgst: 2500, sgst: 2500, igst: 0 }]);
    expect(r.tables.b2b).toEqual([]);
    expect(r.tables.hsnB2c).toEqual([expect.objectContaining({ section: 'B2C', code: '999721', unit: 'NA', qty: 0, rateBps: 500, taxable: 100000, cgst: 2500, sgst: 2500 })]);
    expect(r.tables.hsnB2b).toEqual([]);
    expect(r.tables.documents).toEqual([{ kind: 1, series: [{ from: b.invoiceNumber, to: b.invoiceNumber, total: 1, cancelled: 0 }] }]);
    expect(r.totals).toMatchObject({ taxable: 100000, tax: 5000, total: 105000 });
  });

  it('a business customer goes to B2B with its GSTIN, and to Table 12 B2B', async () => {
    await active();
    await Customer.updateOne({ _id: f.priya._id }, { $set: { gstin: BUYER_GSTIN, gstLegalName: 'Priya Beauty LLP' } });
    const b = await bill();
    const r = await load((await prepare()).returnId);
    expect(r.tables.b2cs).toEqual([]);
    expect(r.tables.b2b[0]).toMatchObject({ ctin: BUYER_GSTIN, legalName: 'Priya Beauty LLP' });
    expect(r.tables.b2b[0].invoices[0]).toMatchObject({ number: b.invoiceNumber, total: 105000, pos: '27', items: [{ rateBps: 500, taxable: 100000, cgst: 2500, sgst: 2500, igst: 0 }] });
    expect(r.tables.hsnB2b).toHaveLength(1);
    expect(r.tables.hsnB2c).toHaveLength(0);
  });

  it('another state: under ₹1 lakh stays in B2C others as IGST, above it is B2C large', async () => {
    await active();
    const toKarnataka = async (price) => {
      const draft = await openDraft(owner, { appointmentId: (await completed(price))._id });
      return issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', payments: [{ method: 'CASH', amount: price }] }, key());
    };
    await toKarnataka(105000);
    const large = await toKarnataka(10500100);
    const r = await load((await prepare()).returnId);
    expect(r.tables.b2cs).toEqual([{ pos: '29', rateBps: 500, supply: 'INTER', taxable: 100000, cgst: 0, sgst: 0, igst: 5000 }]);
    expect(r.tables.b2cl[0]).toMatchObject({ pos: '29', invoices: [expect.objectContaining({ number: large.invoiceNumber, total: 10500100 })] });
    expect(r.status).toBe('READY');
  });

  it('exactly ₹1 lakh isn’t large, and the limit is stored with the return, by month', async () => {
    expect(rulesFor('2026-11')).toMatchObject({ b2cLargeAbovePaise: 10000000 });
    expect(rulesFor('2025-04')).toBe(null);
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed(10000000))._id });
    await issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', payments: [{ method: 'CASH', amount: 10000000 }] }, key());
    const r = await load((await prepare()).returnId);
    expect(r.tables.b2cl).toEqual([]);
    expect(r.rules.b2cLargeAbovePaise).toBe(10000000);
  });

  it('a credit note: registered goes to its own table; on a consumer bill it comes off B2C others', async () => {
    await active();
    const consumer = await bill();
    await createRefund(owner, { invoiceId: consumer._id, lines: [{ lineId: String(consumer.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    await Customer.updateOne({ _id: f.priya._id }, { $set: { gstin: BUYER_GSTIN, gstLegalName: 'Priya Beauty LLP' } });
    const business = await bill();
    const { refund } = await createRefund(owner, { invoiceId: business._id, lines: [{ lineId: String(business.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    const r = await load((await prepare()).returnId);
    expect(r.tables.b2cs[0]).toMatchObject({ taxable: 50000, cgst: 1250, sgst: 1250 });
    expect(r.tables.cdnr[0]).toMatchObject({ ctin: BUYER_GSTIN, notes: [expect.objectContaining({ number: refund.creditNoteNumber, total: 52500, items: [expect.objectContaining({ taxable: 50000, cgst: 1250 })] })] });
    expect(r.tables.hsnB2c[0]).toMatchObject({ taxable: 50000 });
    expect(r.tables.hsnB2b[0]).toMatchObject({ taxable: 50000 });
    expect(r.tables.documents.find((d) => d.kind === 5).series.reduce((n, s) => n + s.total, 0)).toBe(2);
    expect(r.totals).toMatchObject({ taxable: 100000, tax: 5000 });
  });

  it('a credit note on a B2C large bill goes to the unregistered table', async () => {
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed(10500100))._id });
    const large = await issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', payments: [{ method: 'CASH', amount: 10500100 }] }, key());
    await createRefund(owner, { invoiceId: large._id, lines: [{ lineId: String(large.lines[0]._id), partAmount: 500000 }], reason: 'Part' }, key());
    const r = await load((await prepare()).returnId);
    expect(r.tables.cdnur).toHaveLength(1);
    expect(r.tables.cdnur[0]).toMatchObject({ pos: '29', total: 500000 });
  });

  it('a voided bill stays in Table 13 as cancelled, and out of the tables; both entries are listed as left out', async () => {
    await active();
    await bill();
    await bill();
    const open = await checkout(owner, await completed(), { payments: [] });
    await voidInvoice(owner, open._id, { reason: 'Mistake' }, key());
    const r = await load((await prepare()).returnId);
    expect(r.tables.b2cs[0].taxable).toBe(200000);
    expect(r.tables.documents[0].series[0]).toMatchObject({ total: 3, cancelled: 1 });
    expect(r.excluded.map((e) => e.documentNumber)).toEqual([open.invoiceNumber, open.invoiceNumber]);
    expect(r.status).toBe('READY');
  });

  it('advances: taken goes to Table 11A, used to Table 11B, not to Table 12; vouchers are counted; the net is the tax record’s', async () => {
    await active();
    await takeAdvance(desk, { customerId: String(f.priya._id), method: 'UPI', amount: 499900, forServiceIds: [String(f.haircut._id)] }, key());
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    await issueInvoice(desk, draft._id, { version: draft.version, useAdvance: 105000, payments: [] }, key());
    const advance = await CustomerAdvance.findOne({ taxed: true }).lean();
    await giveBackAdvance(owner, advance._id, { amount: 105000, method: 'CASH', reason: 'Part back' }, key());
    const r = await load((await prepare()).returnId);
    expect(r.tables.at).toEqual([{ pos: '27', supply: 'INTRA', items: [{ rateBps: 500, taxable: 476095, cgst: 11903, sgst: 11902, igst: 0 }] }]);
    expect(r.tables.txpd).toEqual([{ pos: '27', supply: 'INTRA', items: [{ rateBps: 500, taxable: 200000, cgst: 5000, sgst: 5000, igst: 0 }] }]);
    expect(r.tables.hsnB2c[0].taxable).toBe(100000);
    expect(r.tables.documents.map((d) => d.kind)).toEqual([1, 6, 8]);
    expect(r.issues.map((i) => i.code)).toContain('ADVANCE_RETURNED');
    const net = await GstTaxEntry.find({ gstin: ANDHERI_GSTIN }).lean();
    expect(r.totals.taxable).toBe(net.reduce((t, e) => t + e.taxable, 0));
    expect(r.totals.tax).toBe(net.reduce((t, e) => t + e.tax, 0));
  });

  it('plain advances show as a warning, which doesn’t block (decision 5)', async () => {
    await active();
    await takeAdvance(desk, { customerId: String(f.priya._id), method: 'CASH', amount: 200000 }, key());
    const r = await load((await prepare()).returnId);
    expect(r.status).toBe('READY');
    expect(r.issues.find((i) => i.code === 'PLAIN_ADVANCE')).toMatchObject({ severity: 'WARNING' });
  });

  it('two GSTINs give two separate returns (G16)', async () => {
    await active();
    await bill();
    await bill(120000, { service: f.facial, staff: f.arjun, branch: f.bandra });
    const a = await load((await prepare(ANDHERI_GSTIN)).returnId);
    const b = await load((await prepare(BANDRA_GSTIN)).returnId);
    expect(a.tables.b2cs[0].taxable).toBe(100000);
    expect(b.tables.b2cs[0].taxable).toBe(114286);
    expect(a.gstin).not.toBe(b.gstin);
  });

  it('two branches on one GSTIN are one return', async () => {
    await active();
    await GstRegistration.deleteMany({ gstin: BANDRA_GSTIN });
    await GstRegistration.updateOne({ gstin: ANDHERI_GSTIN }, { $push: { branches: { branchId: f.bandra._id, from: '2025-01-01', to: null } } });
    await bill();
    await bill(105000, { service: f.facial, staff: f.arjun, branch: f.bandra });
    const r = await load((await prepare()).returnId);
    expect(r.tables.b2cs[0].taxable).toBe(200000);
    expect(r.tables.documents[0].series).toHaveLength(2);
  });
});

// ===========================================================================
describe('Every figure traces back, and every entry is accounted for', () => {
  it('each figure opens its entries, and the whole month is covered exactly once with no difference', async () => {
    await active();
    await setUnits();
    const a = await bill();
    const b = await bill();
    await productSale();
    await createRefund(owner, { invoiceId: b._id, lines: [{ lineId: String(b.lines[0]._id), partAmount: 52500 }], reason: 'Half' }, key());
    const { returnId } = await prepare();
    const r = await load(returnId);
    const trail = await gstr1.returnTrail(owner, returnId, 'b2cs:27|500|INTRA');
    expect(trail.entries.map((e) => e.documentNumber)).toEqual(expect.arrayContaining([a.invoiceNumber, b.invoiceNumber]));
    expect(trail.entries.find((e) => e.documentNumber === a.invoiceNumber).link).toBe(`/app/invoices/${a._id}`);
    expect(r.totals.taxable).toBe(r.totals.record.taxable);
    expect(r.totals.tax).toBe(r.totals.record.cgst + r.totals.record.sgst + r.totals.record.igst);
    const entries = await GstTaxEntry.find({ gstin: ANDHERI_GSTIN }).lean();
    const main = r.lineage.filter((l) => !['hsn', 'documents'].includes(l.table)).flatMap((l) => l.entryIds.map(String));
    expect(new Set(main).size).toBe(main.length);
    expect(main.length + r.excluded.length).toBe(entries.length);
    expect(r.issues.filter((i) => i.severity === 'BLOCKER')).toEqual([]);
    await expect(gstr1.returnTrail(owner, returnId, 'b2b:nothing')).rejects.toMatchObject({ status: 404 });
  });

  it('the builder blocks if an entry would be counted differently from the record', () => {
    const entry = { _id: new mongoose.Types.ObjectId(), type: 'BILL_ISSUED', documentNumber: 'A/1', invoiceId: new mongoose.Types.ObjectId(), taxDate: '2026-11-01', total: 105000, taxable: 100001, cgst: 2500, sgst: 2500, igst: 0, placeOfSupply: { stateCode: '27' }, lines: [{ name: 'Cut', kind: 'SERVICE', rateBps: 500, code: '999721', taxable: 100000, cgst: 2500, sgst: 2500, igst: 0 }] };
    const built = buildGstr1({ entries: [entry], voidedInvoiceIds: new Set(), originals: new Map(), codeOf: (l) => l.code, unitOf: () => null, rules: rulesFor('2026-11'), period: '2026-11', today: '2026-12-01' });
    expect(built.issues.map((i) => i.code)).toContain('RETURN_TOTALS_DIFFERENT');
  });

  it('review copies have every table, in a CSV', async () => {
    await active();
    await bill();
    const { returnId } = await prepare();
    const csv = reviewCsv(await load(returnId));
    expect(csv.rows.map((r) => r.table)).toEqual(expect.arrayContaining(['7 B2C others', '12 HSN/SAC B2C', '13 Documents']));
    // Every row's key opens a real figure
    const r = await load(returnId);
    for (const row of csv.rows) expect(r.lineage.map((l) => l.row)).toContain(row.row);
  });
});

// ===========================================================================
describe('Errors are fixed at the source, then rebuilt', () => {
  it('a product with no official unit blocks, links to where to fix it, and a rebuild makes a new revision (G21, G22)', async () => {
    await active();
    await productSale();
    const first = await prepare();
    expect(first.status).toBe('NEEDS_FIXING');
    const before = await load(first.returnId);
    const issue = before.issues.find((i) => i.code === 'HSN_UQC_MISSING');
    expect(issue).toMatchObject({ severity: 'BLOCKER', link: '/app/gst?tab=settings' });
    expect(issue.message).toContain('Shampoo');
    await expect(gstr1.approveReturn(owner, first.returnId, key())).rejects.toMatchObject({ code: 'RETURN_VALIDATION_BLOCKED' });

    await setUnits();
    const second = await prepare();
    expect(second).toMatchObject({ revision: 2, status: 'READY' });
    const after = await load(second.returnId);
    expect(after.tables.hsnB2c[0]).toMatchObject({ code: '330510', unit: 'BTL', qty: 1, taxable: 100000 });
    // The old revision is kept exactly, only marked as replaced
    const old = await load(first.returnId);
    expect(old).toMatchObject({ revision: 1, status: 'NEEDS_FIXING', superseded: true });
    expect(old.tables).toEqual(before.tables);
    await expect(gstr1.approveReturn(owner, first.returnId, key())).rejects.toMatchObject({ code: 'RETURN_SUPERSEDED' });
  });

  it('the same missing unit on many bills is one thing to fix, and Table 12 describes a code by its rule', async () => {
    await active();
    const first = await productSale();
    await productSale();
    await productSale();
    const r = await load((await prepare()).returnId);
    const missing = r.issues.filter((i) => i.code === 'HSN_UQC_MISSING');
    expect(missing).toHaveLength(1);
    expect(missing[0].message).toContain(`on ${first.invoiceNumber} and 2 more`);
    await setUnits();
    await bill();
    const after = await load((await prepare()).returnId);
    expect(after.tables.hsnB2c.map((h) => h.description).sort()).toEqual(['Hair products', 'Salon services']);
    expect(after.tables.hsnB2c.find((h) => h.code === '330510').qty).toBe(3);
  });

  it('an older bill with no code blocks with a link to the bill; linking its service fixes it on rebuild', async () => {
    await active();
    const b = await bill();
    const [entry] = await GstTaxEntry.find({ invoiceId: b._id }).lean();
    await GstTaxEntry.collection.updateOne({ _id: entry._id }, { $unset: { 'lines.0.code': '' } });
    const rule = await Service.findById(f.haircut._id).lean();
    await Service.updateOne({ _id: f.haircut._id }, { $set: { taxRuleGroupId: null, sacCode: '' } });
    const first = await load((await prepare()).returnId);
    expect(first.issues.find((i) => i.code === 'CODE_MISSING')).toMatchObject({ severity: 'BLOCKER', link: `/app/invoices/${b._id}`, documentNumber: b.invoiceNumber });
    await Service.updateOne({ _id: f.haircut._id }, { $set: { taxRuleGroupId: rule.taxRuleGroupId } });
    expect((await prepare()).status).toBe('READY');
  });

  it('a nil-rated line and a bad customer GSTIN are blocked, not guessed', async () => {
    const line = { name: 'Free cut', kind: 'SERVICE', rateBps: 0, code: '999721', taxable: 1000, cgst: 0, sgst: 0, igst: 0 };
    const entry = { _id: new mongoose.Types.ObjectId(), type: 'BILL_ISSUED', documentNumber: 'A/1', invoiceId: new mongoose.Types.ObjectId(), taxDate: '2026-11-01', total: 1000, taxable: 1000, cgst: 0, sgst: 0, igst: 0, buyer: { gstin: 'BAD' }, placeOfSupply: { stateCode: '99' }, lines: [line] };
    const built = buildGstr1({ entries: [entry], voidedInvoiceIds: new Set(), originals: new Map(), codeOf: (l) => l.code, unitOf: () => null, rules: rulesFor('2026-11'), period: '2026-11', today: '2026-12-01' });
    expect(built.issues.map((i) => i.code)).toEqual(expect.arrayContaining(['NIL_RATED_NOT_SUPPORTED', 'BUYER_GSTIN_INVALID', 'PLACE_OF_SUPPLY_UNRESOLVED']));
  });

  it('months before the start month, another salon’s GSTIN and inactive salons are refused', async () => {
    await expect(prepare()).rejects.toMatchObject({ code: 'GST_NOT_ACTIVE' });
    await active();
    await expect(prepare(ANDHERI_GSTIN, '2025-05')).rejects.toMatchObject({ code: 'BEFORE_START_MONTH' });
    await expect(prepare(GSTIN('29AABCT3518Q1Z'))).rejects.toMatchObject({ status: 404 });
  });

  it('two people preparing at once get coherent, separate revisions (G48)', async () => {
    await active();
    await bill();
    const both = await Promise.all([prepare(), prepare()]);
    expect(both.map((r) => r.revision).sort()).toEqual([1, 2]);
    expect(await GstReturn.countDocuments({ superseded: false })).toBe(1);
  });
});

// ===========================================================================
describe('Approve and export', () => {
  it('the file fits the format: amounts in rupees, DD-MM-YYYY, each section in place (G23)', async () => {
    await active();
    await setUnits();
    await Customer.updateOne({ _id: f.priya._id }, { $set: { gstin: BUYER_GSTIN, gstLegalName: 'Priya Beauty LLP' } });
    const business = await bill();
    await Customer.updateOne({ _id: f.priya._id }, { $unset: { gstin: '', gstLegalName: '' } });
    await bill();
    await productSale();
    const { exported, returnId } = await throughExport();
    const { file } = exported;
    expect(checkFormat(file)).toEqual([]);
    const [year, month] = thisMonth().split('-');
    expect(file).toMatchObject({ gstin: ANDHERI_GSTIN, fp: `${month}${year}`, version: GSTR1_FORMAT.version });
    expect(file.b2b[0].ctin).toBe(BUYER_GSTIN);
    expect(file.b2b[0].inv[0]).toMatchObject({ inum: business.invoiceNumber, val: 1050, pos: '27', rchrg: 'N', inv_typ: 'R' });
    expect(file.b2b[0].inv[0].idt).toMatch(/^\d{2}-\d{2}-\d{4}$/);
    expect(file.b2b[0].inv[0].itms[0]).toEqual({ num: 1, itm_det: { rt: 5, txval: 1000, iamt: 0, camt: 25, samt: 25, csamt: 0 } });
    expect(file.b2cs).toEqual(expect.arrayContaining([{ sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '27', txval: 1000, iamt: 0, camt: 25, samt: 25, csamt: 0 }]));
    expect(file.hsn.hsn_b2c.find((r) => r.hsn_sc === '999721')).toMatchObject({ uqc: 'NA', qty: 0, txval: 1000 });
    expect(file.hsn.hsn_b2c.find((r) => r.hsn_sc === '330510')).toMatchObject({ uqc: 'BTL', qty: 1 });
    expect(file.doc_issue.doc_det[0].doc_num).toBe(1);
    expect(exported.fileName).toContain('rev1');
    expect((await load(returnId)).formatVersion).toBe(GSTR1_FORMAT.version);
  });

  it('the format check catches a bad file', () => {
    const good = toPortalFile({ b2b: [], b2cl: [], b2cs: [], cdnr: [], cdnur: [], at: [], txpd: [], hsnB2b: [], hsnB2c: [], documents: [] }, { gstin: ANDHERI_GSTIN, period: '2026-11' });
    expect(checkFormat(good)).toEqual([]);
    expect(checkFormat({ ...good, gstin: 'BAD' }).length).toBeGreaterThan(0);
    expect(checkFormat({ ...good, extra: 1 }).length).toBeGreaterThan(0);
    expect(checkFormat({ ...good, b2cs: [{ sply_ty: 'INTRA', rt: 5, typ: 'OE', pos: '27', txval: 10.123, iamt: 0, camt: 0, samt: 0, csamt: 0 }] }).length).toBeGreaterThan(0);
    expect(checkFormat({ ...good, hsn: { hsn_b2b: [], hsn_b2c: [{ num: 1, hsn_sc: '999721', desc: 'Cut', uqc: 'BTL', qty: 2, rt: 5, txval: 1, iamt: 0, camt: 0, samt: 0, csamt: 0 }] } }).length).toBeGreaterThan(0);
  });

  it('an approved revision can’t change, and downloading is Exported, never Filed (G24)', async () => {
    await active();
    await bill();
    const { returnId } = await prepare();
    await expect(gstr1.exportReturn(owner, returnId)).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await gstr1.approveReturn(owner, returnId, key());
    const approved = await load(returnId);
    expect(approved).toMatchObject({ status: 'APPROVED', approvedByName: 'Anita' });
    await expect(gstr1.approveReturn(owner, returnId, key())).rejects.toMatchObject({ code: 'ALREADY_APPROVED' });
    await gstr1.exportReturn(owner, returnId);
    await gstr1.exportReturn(owner, returnId);
    const exported = await load(returnId);
    expect(exported.status).toBe('EXPORTED');
    expect(exported.exports).toHaveLength(2);
    expect(exported.filing?.arn).toBeUndefined();
    expect(exported.tables).toEqual(approved.tables);
    expect(exported.json).toEqual(approved.json);
  });

  it('a bill after export needs a new revision, and the old export is kept (G47)', async () => {
    await active();
    await bill();
    const { returnId, exported } = await throughExport();
    await bill();
    expect((await gstr1.getReturn(owner, returnId)).outOfDate).toBe(true);
    await expect(gstr1.recordFiling(owner, returnId, filing, proof, key())).rejects.toMatchObject({ code: 'RETURN_OUT_OF_DATE' });
    const next = await prepare();
    expect(next.revision).toBe(2);
    expect((await load(next.returnId)).tables.b2cs[0].taxable).toBe(200000);
    const old = await load(returnId);
    expect(old).toMatchObject({ status: 'EXPORTED', superseded: true });
    expect(old.json).toEqual(exported.file);
    expect((await gstr1.exportReturn(owner, returnId)).file).toEqual(exported.file);
  });

  it('a void after approval also makes the revision out of date, even in a later month’s record', async () => {
    await active();
    const b = await checkout(owner, await completed(), { payments: [] });
    const { returnId } = await prepare();
    await voidInvoice(owner, b._id, { reason: 'Mistake' }, key());
    await expect(gstr1.approveReturn(owner, returnId, key())).rejects.toMatchObject({ code: 'RETURN_OUT_OF_DATE' });
  });

  it('a rejected upload is marked Rejected with its errors linked to the source, and a new revision follows (G25)', async () => {
    await active();
    const b = await bill();
    const { returnId } = await throughExport();
    await gstr1.markRejected(owner, returnId, { text: `${b.invoiceNumber}: Invalid place of supply\nSomething general went wrong` }, key());
    const r = await load(returnId);
    expect(r.status).toBe('REJECTED');
    expect(r.rejection.rows[0]).toMatchObject({ documentNumber: b.invoiceNumber, link: `/app/invoices/${b._id}` });
    expect(r.rejection.rows[1].link).toBeUndefined();
    await expect(gstr1.recordFiling(owner, returnId, filing, proof, key())).rejects.toMatchObject({ code: 'NOT_EXPORTED' });
    expect((await prepare()).revision).toBe(2);
  });
});

// ===========================================================================
describe('Recording the filing', () => {
  it('November goes from Prepare to fix, Rebuild, Approve, Export and Record filing, with zero differences', async () => {
    await active();
    await productSale();
    await bill();
    expect((await prepare()).status).toBe('NEEDS_FIXING');
    await setUnits();
    const { returnId, status } = await prepare();
    expect(status).toBe('READY');
    await gstr1.approveReturn(owner, returnId, key());
    await gstr1.exportReturn(owner, returnId);
    await gstr1.recordFiling(owner, returnId, filing, proof, key());
    const r = await load(returnId);
    expect(r.status).toBe('FILED');
    expect(r.filing).toMatchObject({ arn: ARN, confirmation: 'MANUALLY_CONFIRMED', proofName: 'ack.pdf', recordedByName: 'Anita' });
    expect(r.totals.taxable).toBe(r.totals.record.taxable);
    expect((await runTaxCheck(new mongoose.Types.ObjectId(owner.orgId))).differences).toEqual([]);
    const month = (await gstr1.listReturns(owner, { gstin: ANDHERI_GSTIN })).months.find((m) => m.period === thisMonth());
    expect(month).toMatchObject({ status: 'FILED', arn: ARN });
    expect(await ActivityLog.exists({ action: 'billing.gst_return_filed' })).toBeTruthy();
  });

  it('recording it twice gives the first answer; the date can’t be in the future or before the month', async () => {
    await active();
    await bill();
    const { returnId } = await throughExport();
    const future = DateTime.now().plus({ days: 3 }).toISODate();
    await expect(gstr1.recordFiling(owner, returnId, { arn: ARN, filedOn: future }, proof, key())).rejects.toMatchObject({ status: 400 });
    await expect(gstr1.recordFiling(owner, returnId, { arn: ARN, filedOn: '2020-01-01' }, proof, key())).rejects.toMatchObject({ status: 400 });
    await gstr1.recordFiling(owner, returnId, filing, proof, key());
    expect(await gstr1.recordFiling(owner, returnId, filing, proof, key())).toEqual({ filed: true });
    await expect(gstr1.recordFiling(owner, returnId, { ...filing, arn: 'AA270426999999B' }, proof, key())).rejects.toMatchObject({ code: 'NOT_EXPORTED' });
    expect((await load(returnId)).filing.arn).toBe(ARN);
  });

  it('a proof is only open to those who may see that GSTIN', async () => {
    await active();
    await bill();
    const { returnId } = await filedMonth();
    const { filing: saved } = await load(returnId);
    const seen = await gstr1.filingProof(owner, saved.proofFileId);
    expect(seen.file.metadata.contentType).toBe('application/pdf');
    seen.stream.destroy();
    await updateSettings(owner, { branchOwners: { viewGst: true } }, key());
    await expect(gstr1.filingProof(bandraOwner, saved.proofFileId)).rejects.toMatchObject({ status: 404 });
    await updateSettings(owner, { branchOwners: { viewGst: false } }, key());
  });

  it('no proof, no Filed; an unexported revision can’t be filed (G26, G37)', async () => {
    await active();
    await bill();
    const { returnId } = await prepare();
    await expect(gstr1.recordFiling(owner, returnId, filing, null, key())).rejects.toMatchObject({ code: 'FILING_NOT_CONFIRMED' });
    await expect(gstr1.recordFiling(owner, returnId, filing, proof, key())).rejects.toMatchObject({ code: 'NOT_EXPORTED' });
    await gstr1.approveReturn(owner, returnId, key());
    await gstr1.exportReturn(owner, returnId);
    await expect(gstr1.recordFiling(owner, returnId, filing, null, key())).rejects.toMatchObject({ code: 'FILING_NOT_CONFIRMED' });
    expect((await load(returnId)).status).toBe('EXPORTED');
  });

  it('a filed month locks: no rebuild and no void, which points to an adjustment case (G39)', async () => {
    await active();
    const b = await checkout(owner, await completed(), { payments: [] });
    const { returnId } = await filedMonth();
    await expect(prepare()).rejects.toMatchObject({ code: 'FILED_PERIOD_LOCKED' });
    await expect(voidInvoice(owner, b._id, { reason: 'Too late' }, key())).rejects.toMatchObject({ code: 'FILED_PERIOD_LOCKED', message: expect.stringContaining('adjustment case'), details: { link: `/app/gst/returns/${returnId}` } });
    expect((await getInvoice(owner, b._id)).status).toBe('ISSUED');
    // A refund is still a new document, in the month it happens: nothing filed changes
    const { refund } = await createRefund(owner, { invoiceId: b._id, lines: [{ lineId: String(b.lines[0]._id), partAmount: 1000 }], reason: 'Later credit' }, key());
    expect(refund.status).toBe('DONE');
    expect((await load(returnId)).status).toBe('FILED');
  });

  it('a bill from before the tax record can’t be voided: it needs a credit note', async () => {
    await active();
    const b = await checkout(owner, await completed(), { payments: [] });
    const earlier = DateTime.now().setZone(INDIA).minus({ months: 3 });
    await Invoice.updateOne({ _id: b._id }, { $set: { issuedAt: earlier.toJSDate(), taxDate: earlier.toISODate() } });
    await expect(voidInvoice(owner, b._id, { reason: 'Old' }, key())).rejects.toMatchObject({ code: 'BEFORE_START_MONTH' });
  });
});

// ===========================================================================
describe('Corrections after filing', () => {
  it('a bill left out before GSTR-3B: the check finds it, and a GSTR-1A case holds only that bill (G27)', async () => {
    await active();
    await bill();
    const { returnId } = await filedMonth();
    const late = await bill();
    const { differences } = await runTaxCheck(new mongoose.Types.ObjectId(owner.orgId));
    expect(differences).toEqual([expect.objectContaining({ code: 'NOT_IN_FILED_RETURN', link: `/app/gst/returns/${returnId}` })]);
    expect((await gstr1.getReturn(owner, returnId)).leftOut.map((e) => e.documentNumber)).toEqual([late.invoiceNumber]);

    const filedBefore = await load(returnId);
    const made = await gstr1.createAdjustment(owner, returnId, { reason: 'Bill left out' }, key());
    expect(made).toMatchObject({ route: 'GSTR_1A', status: 'DRAFT' });
    const adjustment = await GstAdjustment.findById(made.adjustmentId).lean();
    expect(adjustment.totals).toMatchObject({ taxable: 100000, tax: 5000 });
    expect(adjustment.tables.b2cs[0].taxable).toBe(100000);
    expect(await load(returnId)).toEqual(filedBefore); // the filed return isn't touched

    const { file, fileName } = await gstr1.exportAdjustment(owner, made.adjustmentId);
    expect(fileName).toContain('GSTR1A');
    expect(file.b2cs[0]).toMatchObject({ txval: 1000 });
    await expect(gstr1.recordAdjustmentFiled(owner, made.adjustmentId, filing, null, key())).rejects.toMatchObject({ code: 'FILING_NOT_CONFIRMED' });
    await gstr1.recordAdjustmentFiled(owner, made.adjustmentId, filing, proof, key());
    expect(await GstAdjustment.findById(made.adjustmentId).lean()).toMatchObject({ status: 'FILED', filing: { arn: ARN } });
    expect((await runTaxCheck(new mongoose.Types.ObjectId(owner.orgId))).differences).toEqual([]);
  });

  it('after GSTR-3B, GSTR-1A is closed and it goes to a later-period amendment for review (G28)', async () => {
    await active();
    await bill();
    const { returnId } = await filedMonth();
    await gstr1.recordGstr3b(owner, returnId, filing, key());
    await bill();
    const made = await gstr1.createAdjustment(owner, returnId, { reason: 'Bill left out' }, key());
    expect(made).toMatchObject({ route: 'LATER_AMENDMENT', status: 'NEEDS_REVIEW' });
    await expect(gstr1.exportAdjustment(owner, made.adjustmentId)).rejects.toMatchObject({ code: 'AMENDMENT_REVIEW_REQUIRED' });
  });

  it('nothing left out, but a correction wanted: it goes to review, and only a filed month has cases', async () => {
    await active();
    const b = await bill();
    const { returnId } = await throughExport();
    await expect(gstr1.createAdjustment(owner, returnId, { reason: 'x wrong' }, key())).rejects.toMatchObject({ code: 'NOT_FILED' });
    await gstr1.recordFiling(owner, returnId, filing, proof, key());
    const made = await gstr1.createAdjustment(owner, returnId, { reason: 'Wrong customer', invoiceId: String(b._id) }, key());
    expect(made.status).toBe('NEEDS_REVIEW');
  });

  it('GSTR-3B needs GSTR-1 filed first', async () => {
    await active();
    await bill();
    const { returnId } = await prepare();
    await expect(gstr1.recordGstr3b(owner, returnId, filing, key())).rejects.toMatchObject({ code: 'NOT_FILED' });
  });
});

// ===========================================================================
describe('Who can do what', () => {
  it('branch owners: view if delegated, approve only if that is switched on too, their GSTINs only', async () => {
    await active();
    await bill();
    const andheri = await prepare();
    await bill(120000, { service: f.facial, staff: f.arjun, branch: f.bandra });
    const bandra = await prepare(BANDRA_GSTIN);

    await expect(gstr1.listReturns(bandraOwner, {})).rejects.toMatchObject({ status: 403 });
    await expect(gstr1.getReturn(bandraOwner, bandra.returnId)).rejects.toMatchObject({ status: 403 });
    await updateSettings(owner, { branchOwners: { viewGst: true } }, key());
    const list = await gstr1.listReturns(bandraOwner, {});
    expect(list).toMatchObject({ gstin: BANDRA_GSTIN, canWork: false });
    expect(list.gstins.map((g) => g.gstin)).toEqual([BANDRA_GSTIN]);
    expect((await gstr1.getReturn(bandraOwner, bandra.returnId)).canWork).toBe(false);
    await expect(gstr1.getReturn(bandraOwner, andheri.returnId)).rejects.toMatchObject({ status: 404 });
    await expect(gstr1.approveReturn(bandraOwner, bandra.returnId, key())).rejects.toMatchObject({ status: 403 });
    await expect(prepare(BANDRA_GSTIN, thisMonth(), bandraOwner)).rejects.toMatchObject({ status: 403 });

    await updateSettings(owner, { branchOwners: { approveReturns: true } }, key());
    await gstr1.approveReturn(bandraOwner, bandra.returnId, key());
    expect((await load(bandra.returnId)).status).toBe('APPROVED');
    await expect(gstr1.approveReturn(bandraOwner, andheri.returnId, key())).rejects.toMatchObject({ status: 404 });
    await expect(prepare(ANDHERI_GSTIN, thisMonth(), bandraOwner)).rejects.toMatchObject({ status: 404 });
    await expect(gstr1.saveUnitCodes(bandraOwner, { units: { bottle: 'BTL' } }, key())).rejects.toMatchObject({ status: 403 });
    await updateSettings(owner, { branchOwners: { viewGst: false, approveReturns: false } }, key());
  });

  it('another salon can’t reach a return (G41)', async () => {
    await active();
    await bill();
    const { returnId } = await prepare();
    const other = { ...f.ctxDesert, userName: 'Fatima', role: 'OWNER', isPrimaryOwner: true };
    await expect(gstr1.getReturn(other, returnId)).rejects.toMatchObject({ status: 404 });
    await expect(gstr1.approveReturn(other, returnId, key())).rejects.toMatchObject({ status: 404 });
    await expect(gstr1.exportReturn(other, returnId)).rejects.toMatchObject({ status: 404 });
  });
});

describe('GSTR-1 through the API', () => {
  const PASSWORD = 'Password@123';
  let server;
  let api;
  const cookies = {};
  const call = async (who, method, path, body, { form } = {}) => {
    const headers = { 'idempotency-key': `test-${new mongoose.Types.ObjectId()}`, ...(form ? {} : { 'content-type': 'application/json' }) };
    if (who) headers.cookie = cookies[who];
    const res = await fetch(`${api}${path}`, { method, headers, body: form ?? (body && JSON.stringify(body)) });
    const type = res.headers.get('content-type') ?? '';
    const isJson = type.includes('json');
    return { status: res.status, type, disposition: res.headers.get('content-disposition'), json: isJson ? await res.json() : null, bytes: isJson ? 0 : (await res.arrayBuffer()).byteLength };
  };

  beforeAll(async () => {
    const g = f.ctxGlamour.orgId;
    await Organization.updateOne({ _id: g }, { $set: { 'addons.inventory.enabled': true } });
    const passwordHash = await hashPassword(PASSWORD);
    await User.create([
      { orgId: g, role: 'OWNER', name: 'Biz', email: 'biz4@g.com', passwordHash, allBranches: true },
      { orgId: g, role: 'FRONT_DESK', name: 'Desk', email: 'desk4@g.com', passwordHash, branchIds: [f.andheri._id] },
      { orgId: g, role: 'INVENTORY', name: 'Stock', email: 'stock4@g.com', passwordHash, branchIds: [f.andheri._id] },
    ]);
    server = app.listen(0);
    api = `http://127.0.0.1:${server.address().port}/api`;
    for (const [who, email] of Object.entries({ business: 'biz4@g.com', desk: 'desk4@g.com', stock: 'stock4@g.com' })) {
      const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      cookies[who] = res.headers.get('set-cookie')?.split(';')[0];
    }
  });
  afterAll(() => server?.close());

  it('the whole way through, with proof uploaded; the front desk and inventory are refused (G37, G40)', async () => {
    await active();
    await bill();
    const prepared = await call('business', 'POST', '/gst/returns', { gstin: ANDHERI_GSTIN, period: thisMonth() });
    expect(prepared.status).toBe(201);
    const id = prepared.json.returnId;

    for (const who of ['desk', 'stock']) {
      expect((await call(who, 'GET', '/gst/returns')).status).toBe(403);
      expect((await call(who, 'GET', `/gst/returns/${id}`)).status).toBe(403);
      expect((await call(who, 'POST', `/gst/returns/${id}/approve`)).status).toBe(403);
      expect((await call(who, 'POST', `/gst/returns/${id}/export`)).status).toBe(403);
    }
    expect((await call(null, 'GET', '/gst/returns')).status).toBe(401);

    expect((await call('business', 'POST', `/gst/returns/${id}/approve`)).status).toBe(200);
    const file = await call('business', 'POST', `/gst/returns/${id}/export`);
    expect(file.disposition).toContain('.json');
    expect(file.json.gstin).toBe(ANDHERI_GSTIN);
    expect((await call('business', 'GET', `/gst/returns/${id}/review.csv`)).type).toContain('csv');
    expect((await call('business', 'GET', `/gst/returns/${id}/review.pdf`)).bytes).toBeGreaterThan(500);
    expect((await call('business', 'GET', `/gst/returns/${id}/trail?row=${encodeURIComponent('b2cs:27|500|INTRA')}`)).json.total).toBe(1);

    const form = (withFile) => {
      const data = new FormData();
      data.set('arn', ARN);
      data.set('filedOn', filing.filedOn);
      if (withFile) data.set('proof', new Blob(['%PDF-1.4'], { type: 'application/pdf' }), 'ack.pdf');
      return data;
    };
    expect((await call('business', 'POST', `/gst/returns/${id}/file`, null, { form: form(false) })).status).toBe(400);
    const bad = new FormData();
    bad.set('arn', 'short');
    bad.set('filedOn', filing.filedOn);
    bad.set('proof', new Blob(['x'], { type: 'application/pdf' }), 'ack.pdf');
    expect((await call('business', 'POST', `/gst/returns/${id}/file`, null, { form: bad })).status).toBe(400);
    const wrongType = form(false);
    wrongType.set('proof', new Blob(['x'], { type: 'text/plain' }), 'ack.txt');
    expect((await call('business', 'POST', `/gst/returns/${id}/file`, null, { form: wrongType })).status).toBe(400);
    expect((await call('business', 'POST', `/gst/returns/${id}/file`, null, { form: form(true) })).status).toBe(200);

    const seen = (await call('business', 'GET', `/gst/returns/${id}`)).json;
    expect(seen).toMatchObject({ status: 'FILED', filing: { arn: ARN, confirmation: 'MANUALLY_CONFIRMED' }, format: { checkedAgainstPortal: false } });
    expect(seen.json).toBeUndefined();
    const stored = await call('business', 'GET', `/gst/proofs/${seen.filing.proofFileId}`);
    expect(stored.type).toContain('pdf');
    expect((await call('desk', 'GET', `/gst/proofs/${seen.filing.proofFileId}`)).status).toBe(403);
    expect((await call('business', 'GET', `/gst/proofs/${new mongoose.Types.ObjectId()}`)).status).toBe(404);
  });

  it('unit codes are saved through Settings, and only official ones', async () => {
    await active();
    expect((await call('business', 'PATCH', '/gst/units', { units: { bottle: 'NOPE' } })).status).toBe(400);
    const saved = await call('business', 'PATCH', '/gst/units', { units: { bottle: 'BTL' } });
    expect(saved.json.setup.units.rows.find((r) => r.unit === 'bottle')).toMatchObject({ code: 'BTL' });
    expect((await call('desk', 'PATCH', '/gst/units', { units: { bottle: 'BTL' } })).status).toBe(403);
  });
});
