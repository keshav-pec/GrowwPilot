// GST Phase 5: purchase bills, GSTR-2B import and matching, ITC decisions, the GSTR-3B working sheet. G numbers are from the GST PRD.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import {
  ActivityLog, Appointment, BillingSettings, CommissionEntry, Counter, CreditNote, CustomerAdvance, Gst2bImport, GstAdjustment, GstCheck, GstItcDecision, GstPurchaseBill, GstRegistration, GstReturn, GstTaxEntry, GstTaxRule, GstWorksheet, IdempotencyRecord, InventorySku, Invoice, Notification, Organization, Payment, PaymentAllocation, PayPlan, Refund, Service, User,
} from '../src/models/index.js';
import { gstinCheckChar } from '../src/config/billing.js';
import * as gst from '../src/modules/gst/gst.service.js';
import * as gstr1 from '../src/modules/gst/gstr1.service.js';
import * as purchases from '../src/modules/gst/gst.purchases.js';
import * as sheet from '../src/modules/gst/gst.worksheet.js';
import { overview } from '../src/modules/gst/gst.record.js';
import { matchKeyOf, matchPurchases, normalizeNumber, parse2bCsv, parse2bJson, suggestItc } from '../src/modules/gst/gst.purchases.rules.js';
import { updateSettings } from '../src/modules/billing/settings.service.js';
import { addProduct, createSaleDraft, issueInvoice, openDraft, voidInvoice } from '../src/modules/invoices/invoices.service.js';
import { takeAdvance } from '../src/modules/payments/payments.service.js';
import { createSku } from '../src/modules/inventory/skus/skus.service.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

const GSTIN = (first14) => first14 + gstinCheckChar(first14);
const ANDHERI_GSTIN = GSTIN('27AAKCG4821M1Z');
const BANDRA_GSTIN = GSTIN('27AAKCG4821M2Z');
const SUPPLIER = GSTIN('27AABCS1429B1Z');
const OTHER_SUPPLIER = GSTIN('29AABCT3518Q1Z');
const INDIA = 'Asia/Kolkata';
const today = () => DateTime.now().setZone(INDIA).toISODate();
const thisMonth = () => today().slice(0, 7);
const fp = () => { const [y, m] = thisMonth().split('-'); return `${m}${y}`; };
const proof = { originalname: 'ack.pdf', mimetype: 'application/pdf', buffer: Buffer.from('%PDF-1.4 ack') };
const filing = () => ({ arn: 'AA270426123456A', filedOn: today() });
const ZERO = { igst: 0, cgst: 0, sgst: 0 };

let f;
let owner;
let bandraOwner;
let shampoo;

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [anita, vikram] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita5@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram5@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
  ]);
  const base = { ...f.ctxGlamour, addons: ['inventory'], activeBranchId: String(f.andheri._id) };
  owner = { ...base, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  bandraOwner = { ...base, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
  shampoo = (await createSku(owner, { name: 'Shampoo', category: 'Retail', stockUnit: 'bottle', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 118000, openingQty: 500 }, key())).sku;
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all([BillingSettings, GstRegistration, GstTaxRule, GstTaxEntry, GstCheck, GstReturn, GstAdjustment, GstPurchaseBill, Gst2bImport, GstItcDecision, GstWorksheet, Appointment, Invoice, Counter, Payment, PaymentAllocation, Refund, CreditNote, IdempotencyRecord, CommissionEntry, PayPlan, Notification, CustomerAdvance].map((m) => m.deleteMany({})));
  await Service.updateMany({}, { $set: { taxRuleGroupId: null } });
  await InventorySku.updateMany({}, { $set: { taxRuleGroupId: null } });
});

function completed(price = 105000) {
  const at = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: at, endAt: at, durationMinutes: 30, price }],
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

// ₹590: ₹500 + ₹45 + ₹45, used only for salon services
const billInput = (extra = {}) => ({ gstin: ANDHERI_GSTIN, period: thisMonth(), supplierName: 'ABC Pvt Ltd', supplierGstin: SUPPLIER, billNumber: 'INV-009', billDate: today(), taxable: 50000, igst: 0, cgst: 4500, sgst: 4500, use: 'NO_ITC_SERVICES', ...extra });
const add = (extra, ctx = owner) => purchases.addPurchase(ctx, billInput(extra), key());
const rowFor = (row = {}) => ({ ctin: SUPPLIER, trdnm: 'ABC Pvt Ltd', inv: [{ inum: 'INV-009', dt: `01-${thisMonth().slice(5)}-${thisMonth().slice(0, 4)}`, val: 590, pos: '27', typ: 'R', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 500, igst: 0, cgst: 45, sgst: 45, cess: 0 }] }], ...row });
const fileOf = (groups, meta = {}) => ({ originalname: '2b.json', mimetype: 'application/json', buffer: Buffer.from(JSON.stringify({ data: { gstin: ANDHERI_GSTIN, rtnprd: fp(), docdata: { b2b: groups } }, ...meta })) });
const import2b = (groups = [rowFor()]) => purchases.import2b(owner, { gstin: ANDHERI_GSTIN, period: thisMonth() }, fileOf(groups), key());
const screen = (gstin = ANDHERI_GSTIN, ctx = owner) => purchases.purchasesScreen(ctx, { gstin, period: thisMonth() });
const prepare = () => sheet.prepareWorksheet(owner, { gstin: ANDHERI_GSTIN, period: thisMonth() }, key());
async function fileGstr1() {
  const { returnId } = await gstr1.prepareReturn(owner, { gstin: ANDHERI_GSTIN, period: thisMonth() }, key());
  await gstr1.approveReturn(owner, returnId, key());
  await gstr1.exportReturn(owner, returnId);
  await gstr1.recordFiling(owner, returnId, filing(), proof, key());
  return returnId;
}

// ===========================================================================
describe('Reading GSTR-2B', () => {
  it('reads a file with data.docdata, docdata, or b2b directly under data', () => {
    const groups = [rowFor()];
    for (const text of [{ data: { gstin: ANDHERI_GSTIN, rtnprd: '112026', docdata: { b2b: groups } } }, { data: { docdata: { b2b: groups } } }, { docdata: { b2b: groups } }, { data: { b2b: groups } }]) {
      const { rows } = parse2bJson(JSON.stringify(text));
      expect(rows[0]).toMatchObject({ supplierGstin: SUPPLIER, supplierName: 'ABC Pvt Ltd', billNumber: 'INV-009', taxable: 50000, cgst: 4500, sgst: 4500, igst: 0, kind: 'INVOICE', itcAvailable: true });
    }
    expect(parse2bJson(JSON.stringify({ data: { rtnprd: '112026', docdata: {} } })).period).toBe('2026-11');
  });

  it('adds up items, reads credit notes and amendments, and keeps what the portal says', () => {
    const { rows } = parse2bJson(JSON.stringify({ data: { docdata: {
      b2b: [{ ctin: SUPPLIER, inv: [{ inum: '1', dt: '05-11-2026', itcavl: 'N', rsn: 'P', imsStatus: 'Accepted', items: [{ txval: 100, cgst: 9, sgst: 9 }, { txval: 50.5, cgst: 4.55, sgst: 4.55 }] }] }],
      cdnr: [{ ctin: SUPPLIER, nt: [{ ntnum: 'CN1', dt: '06-11-2026', items: [{ txval: 10, igst: 1.8 }] }] }],
      b2ba: [{ ctin: SUPPLIER, inv: [{ inum: 'A1', dt: '07-11-2026', items: [{ txval: 1 }] }] }],
    } } }));
    expect(rows[0]).toMatchObject({ taxable: 15050, cgst: 1355, sgst: 1355, itcAvailable: false, reason: 'P', imsStatus: 'Accepted', billDate: '2026-11-05' });
    expect(rows[1]).toMatchObject({ kind: 'CREDIT_NOTE', igst: 180 });
    expect(rows[2]).toMatchObject({ kind: 'OTHER' });
  });

  it('a file that can’t be read says so; the CSV layout is the fallback', () => {
    expect(() => parse2bJson('not json')).toThrow('valid JSON');
    expect(() => parse2bCsv('Name,Amount\nA,1')).toThrow('needs these columns');
    const { rows } = parse2bCsv(`﻿Supplier GSTIN,Supplier name,Bill number,Bill date,Taxable,IGST,CGST,SGST\n${SUPPLIER},"ABC, Pvt Ltd",INV-009,05-11-2026,500,0,45,45\n`);
    expect(rows[0]).toMatchObject({ supplierGstin: SUPPLIER, supplierName: 'ABC, Pvt Ltd', taxable: 50000, cgst: 4500, billDate: '2026-11-05', matchKey: matchKeyOf(SUPPLIER, 'INV009') });
  });

  it('bill numbers match however they are written', () => {
    expect(normalizeNumber('inv/0-009 ')).toBe(normalizeNumber('INV0009'));
    expect(normalizeNumber('000123')).toBe('123');
    expect(normalizeNumber('0')).toBe('0');
    expect(matchKeyOf(SUPPLIER, 'inv-9')).not.toBe(matchKeyOf(OTHER_SUPPLIER, 'inv-9'));
  });

  it('the same file twice isn’t counted again; another file becomes the current one, and the old stays (G32)', async () => {
    await active();
    const period = thisMonth();
    const first = await purchases.import2b(owner, { gstin: ANDHERI_GSTIN, period }, fileOf([rowFor()]), key());
    expect(first).toEqual({ alreadyImported: false, rowCount: 1 });
    expect(await purchases.import2b(owner, { gstin: ANDHERI_GSTIN, period }, fileOf([rowFor()]), key())).toEqual({ alreadyImported: true, rowCount: 1 });
    expect(await Gst2bImport.countDocuments()).toBe(1);
    await purchases.import2b(owner, { gstin: ANDHERI_GSTIN, period }, fileOf([rowFor(), rowFor({ ctin: OTHER_SUPPLIER, trdnm: 'XYZ' })]), key());
    expect(await Gst2bImport.countDocuments()).toBe(2);
    expect((await screen()).imported.rowCount).toBe(2);
  });

  it('a file for another GSTIN or month, or with a bad row, is refused', async () => {
    await active();
    const period = thisMonth();
    await expect(purchases.import2b(owner, { gstin: BANDRA_GSTIN, period }, fileOf([rowFor()]), key())).rejects.toMatchObject({ code: 'WRONG_2B_FILE' });
    await expect(purchases.import2b(owner, { gstin: ANDHERI_GSTIN, period: '2026-01' }, fileOf([rowFor()]), key())).rejects.toMatchObject({ code: 'WRONG_2B_FILE' });
    await expect(purchases.import2b(owner, { gstin: ANDHERI_GSTIN, period }, fileOf([rowFor({ ctin: 'BAD' })]), key())).rejects.toMatchObject({ code: 'FILE_NOT_READABLE' });
    await expect(purchases.import2b(owner, { gstin: ANDHERI_GSTIN, period }, null, key())).rejects.toMatchObject({ status: 400 });
  });
});

// ===========================================================================
describe('Matching', () => {
  it('a ₹590 bill matches GSTR-2B: ₹0 suggested as credit, ₹90 not eligible (G29)', async () => {
    await active();
    await add();
    await import2b();
    const { rows, summary } = await screen();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'MATCHED', resolved: false, suggestion: { eligible: ZERO, notEligible: { igst: 0, cgst: 4500, sgst: 4500 }, needsDecision: false } });
    expect(summary).toMatchObject({ booksTax: 9000, portalTax: 9000, claimed: 0, unresolved: 1 });
  });

  it('a bill not in GSTR-2B is Missing in 2B, and no credit can be claimed (G30)', async () => {
    await active();
    const { billId } = await add({ use: 'RESALE' });
    await import2b([]);
    expect((await screen()).rows[0]).toMatchObject({ status: 'MISSING_IN_2B', portal: null });
    await expect(purchases.decideItc(owner, billId, { eligible: { igst: 0, cgst: 4500, sgst: 4500 }, reason: 'Claim it' }, key())).rejects.toMatchObject({ code: 'ITC_POLICY_UNRESOLVED' });
    // Deciding not to claim it is fine
    await purchases.decideItc(owner, billId, { eligible: ZERO, reason: 'Wait for the supplier to file' }, key());
    expect((await screen()).rows[0].resolved).toBe(true);
  });

  it('a GSTR-2B row not in the books is Missing in books, and can be decided as not claimed (G31)', async () => {
    await active();
    await import2b();
    const { rows } = await screen();
    expect(rows[0]).toMatchObject({ status: 'MISSING_IN_BOOKS', bill: null, resolved: false });
    await purchases.decideMissingRow(owner, { gstin: ANDHERI_GSTIN, period: thisMonth(), rowKey: rows[0].key, reason: 'Not our purchase' }, key());
    const after = (await screen()).rows[0];
    expect(after.resolved).toBe(true);
    expect(after.decision).toMatchObject({ eligible: ZERO, notEligible: { cgst: 4500 }, matchStatus: 'MISSING_IN_BOOKS' });
    await expect(purchases.decideMissingRow(owner, { gstin: ANDHERI_GSTIN, period: thisMonth(), rowKey: '2b:nothing', reason: 'Nope' }, key())).rejects.toMatchObject({ status: 404 });
  });

  it('different amounts are Amount mismatch, with the difference shown; a rupee of rounding still matches (G33)', async () => {
    await active();
    await add({ cgst: 4600, sgst: 4500 });
    await import2b();
    expect((await screen()).rows[0].status).toBe('MATCHED');
    await GstPurchaseBill.updateMany({}, { $set: { cgst: 5000 } });
    const row = (await screen()).rows[0];
    expect(row.status).toBe('AMOUNT_MISMATCH');
    expect(row.difference).toEqual({ taxable: 0, igst: 0, cgst: 500, sgst: 0 });
  });

  it('the same bill twice: the second is a duplicate and can’t be decided, until cancelled', async () => {
    await active();
    await add();
    const { billId } = await add({ billNumber: 'inv/009' });
    await import2b();
    const { rows } = await screen();
    expect(rows.map((r) => r.status)).toEqual(['MATCHED', 'DUPLICATE']);
    await expect(purchases.decideItc(owner, billId, { eligible: ZERO, reason: 'Duplicate?' }, key())).rejects.toMatchObject({ code: 'DUPLICATE_BILL' });
    await purchases.cancelPurchase(owner, billId, { reason: 'Entered twice' }, key());
    expect((await screen()).rows.map((r) => r.status)).toEqual(['MATCHED']);
    expect(await GstPurchaseBill.countDocuments()).toBe(2); // it stays on record
    await expect(purchases.cancelPurchase(owner, billId, { reason: 'Again' }, key())).rejects.toMatchObject({ code: 'ALREADY_CANCELLED' });
  });

  it('a duplicate is caught across months', () => {
    const a = { _id: 'a', matchKey: 'X|1', taxable: 1, igst: 0, cgst: 0, sgst: 0 };
    const b = { _id: 'b', matchKey: 'X|1', taxable: 1, igst: 0, cgst: 0, sgst: 0 };
    expect(matchPurchases([b], [], [a, b])[0].status).toBe('DUPLICATE');
  });

  it('no GSTR-2B yet: Not checked. Portal says no credit, or a number under another supplier: Needs review', async () => {
    await active();
    await add();
    expect((await screen()).rows[0].status).toBe('NOT_CHECKED');
    await import2b([rowFor({ inv: [{ ...rowFor().inv[0], itcavl: 'N', rsn: 'Blocked' }] })]);
    expect((await screen()).rows[0]).toMatchObject({ status: 'REVIEW_REQUIRED', note: expect.stringContaining('Blocked') });
    await import2b([rowFor({ ctin: OTHER_SUPPLIER })]);
    const rows = (await screen()).rows;
    expect(rows[0]).toMatchObject({ status: 'REVIEW_REQUIRED', note: expect.stringContaining(OTHER_SUPPLIER) });
  });
});

// ===========================================================================
describe('Adding bills', () => {
  it('checks the GSTIN and amounts; a bill can link to a delivery or supplier only in this salon', async () => {
    await active();
    await expect(add({ supplierGstin: '27AABCS1429B1ZX' })).rejects.toMatchObject({ code: 'SUPPLIER_GSTIN_INVALID', details: { field: 'supplierGstin' } });
    await expect(add({ igst: 100 })).rejects.toMatchObject({ status: 400 });
    await expect(add({ billDate: '2099-01-01' })).rejects.toMatchObject({ status: 400 });
    await expect(add({ gstin: GSTIN('29AABCT3518Q2Z') })).rejects.toMatchObject({ status: 404 });
    await expect(add({ receiptId: String(new mongoose.Types.ObjectId()) })).rejects.toMatchObject({ status: 404 });
    await expect(add({ supplierId: String(new mongoose.Types.ObjectId()) })).rejects.toMatchObject({ status: 404 });
    expect(await GstPurchaseBill.countDocuments()).toBe(0);
  });

  it('a late bill can go in a later month than its date', async () => {
    await active();
    const earlier = DateTime.now().setZone(INDIA).minus({ months: 1 }).toISODate();
    await expect(add({ billDate: earlier })).resolves.toBeTruthy();
  });

  it('works without the Inventory add-on', async () => {
    await active();
    const noAddon = { ...owner, addons: [] };
    await expect(add({}, noAddon)).resolves.toBeTruthy();
    expect((await screen(ANDHERI_GSTIN, noAddon)).rows).toHaveLength(1);
  });

  it('a retried bill is added once', async () => {
    await active();
    const k = key();
    await purchases.addPurchase(owner, billInput(), k);
    await purchases.addPurchase(owner, billInput(), k);
    expect(await GstPurchaseBill.countDocuments()).toBe(1);
  });
});

// ===========================================================================
describe('ITC decisions', () => {
  it('suggestions follow how the goods are used', () => {
    const bill = { igst: 0, cgst: 900, sgst: 900 };
    expect(suggestItc({ ...bill, use: 'NO_ITC_SERVICES' })).toMatchObject({ eligible: ZERO, needsDecision: false });
    expect(suggestItc({ ...bill, use: 'RESALE' })).toMatchObject({ eligible: { cgst: 900 }, needsDecision: true });
    expect(suggestItc({ ...bill, use: 'MIXED' })).toMatchObject({ eligible: null, needsDecision: true });
  });

  it('a match alone never claims anything: nothing counts until the owner decides, with a reason (G34)', async () => {
    await active();
    const { billId } = await add({ use: 'MIXED' });
    await import2b();
    expect((await screen()).summary.claimed).toBe(0);
    await purchases.decideItc(owner, billId, { eligible: { igst: 0, cgst: 2000, sgst: 2000 }, reason: 'Half goes to retail' }, key());
    const row = (await screen()).rows[0];
    expect(row.decision).toMatchObject({ eligible: { cgst: 2000, sgst: 2000 }, notEligible: { cgst: 2500, sgst: 2500 }, matchStatus: 'MATCHED', decidedByName: 'Anita', reason: 'Half goes to retail' });
    expect((await screen()).summary.claimed).toBe(4000);
  });

  it('credit on a bill used only for 5% services is refused, and more than the bill’s tax is refused', async () => {
    await active();
    const { billId } = await add();
    const resale = await add({ billNumber: 'R-1', use: 'RESALE' });
    await import2b([rowFor(), rowFor({ inv: [{ ...rowFor().inv[0], inum: 'R-1' }] })]);
    await expect(purchases.decideItc(owner, billId, { eligible: { igst: 0, cgst: 1, sgst: 0 }, reason: 'Try' }, key())).rejects.toMatchObject({ code: 'ITC_NOT_ALLOWED' });
    await expect(purchases.decideItc(owner, resale.billId, { eligible: { igst: 0, cgst: 4501, sgst: 0 }, reason: 'Try' }, key())).rejects.toMatchObject({ code: 'ITC_TOO_HIGH' });
  });

  it('changing a decision adds a new one and keeps the old; decisions can’t be edited', async () => {
    await active();
    const { billId } = await add({ use: 'RESALE' });
    await import2b();
    await purchases.decideItc(owner, billId, { eligible: { igst: 0, cgst: 4500, sgst: 4500 }, reason: 'All resale' }, key());
    await purchases.decideItc(owner, billId, { eligible: ZERO, reason: 'Actually used in services' }, key());
    const row = (await screen()).rows[0];
    expect(row.history).toHaveLength(2);
    expect(row.decision.reason).toBe('Actually used in services');
    await expect(GstItcDecision.updateOne({}, { $set: { reason: 'x' } })).rejects.toThrow('cannot be changed');
  });

  it('a decision made before the file changed the match needs deciding again', async () => {
    await active();
    const { billId } = await add({ use: 'RESALE' });
    await import2b();
    await purchases.decideItc(owner, billId, { eligible: { igst: 0, cgst: 4500, sgst: 4500 }, reason: 'Resale' }, key());
    expect((await screen()).rows[0].resolved).toBe(true);
    await import2b([rowFor({ inv: [{ ...rowFor().inv[0], items: [{ num: 1, rt: 18, txval: 400, cgst: 36, sgst: 36 }] }] })]);
    expect((await screen()).rows[0]).toMatchObject({ status: 'AMOUNT_MISMATCH', resolved: false });
  });

  it('the Overview counts bills waiting for a decision', async () => {
    await active();
    await add();
    expect((await overview(owner, {})).purchasesToDecide).toBe(1);
  });
});

// ===========================================================================
describe('The GSTR-3B working sheet', () => {
  async function november() {
    await checkout(owner, await completed(105000), { payments: [{ method: 'CASH', amount: 105000 }] });
    await takeAdvance(owner, { customerId: String(f.priya._id), method: 'UPI', amount: 499900, forServiceIds: [String(f.haircut._id)] }, key());
    let sale = await createSaleDraft(owner, { customerId: String(f.priya._id) });
    sale = await addProduct(owner, sale._id, { version: sale.version, skuId: String(shampoo._id), qty: 1 });
    await issueInvoice(owner, sale._id, { version: sale.version, payments: [{ method: 'CARD', amount: 118000 }] }, key());
  }

  it('haircut + package + product + purchase: ₹468.05 output tax and no ₹90 credit (G35)', async () => {
    await active();
    await november();
    const { billId } = await add();
    await import2b();
    await purchases.decideItc(owner, billId, { eligible: ZERO, reason: 'Used only for 5% salon services' }, key());
    const { worksheetId } = await prepare();
    const seen = await sheet.getWorksheet(owner, worksheetId);
    expect(seen.summary).toMatchObject({ outputTax: 46805, taxable: 676095, itc: 0, notClaimed: 9000 });
    expect(seen.rows.find((r) => r.key === '3.1(a)')).toMatchObject({ taxable: 676095, cgst: 23403, sgst: 23402, igst: 0, count: 3 });
    expect(seen.rows.find((r) => r.key === '4A(5)')).toMatchObject({ cgst: 0, sgst: 0 });
    expect(seen.rows.find((r) => r.key === 'NOT_CLAIMED')).toMatchObject({ table: 'memo', cgst: 4500, sgst: 4500, count: 1 });
    expect(seen.mapping.rows).not.toContain('NOT_CLAIMED'); // it isn't a row of the form
    expect(seen.notes.filter((n) => n.severity === 'BLOCKER')).toEqual([]);
    expect(seen.summary.afterCredit).toEqual({ igst: 0, cgst: 23403, sgst: 23402 });
    // It holds tax only: nothing about money paid, interest, late fees or balances
    expect(Object.keys(seen.summary).join()).not.toMatch(/paid|interest|fee|balance|ledger/i);
  });

  it('every ITC amount claimed traces to one bill and one approved decision', async () => {
    await active();
    const { billId } = await add({ use: 'RESALE' });
    await import2b();
    const { decisionId } = await purchases.decideItc(owner, billId, { eligible: { igst: 0, cgst: 4500, sgst: 4500 }, reason: 'Resale' }, key());
    const { worksheetId } = await prepare();
    const trail = await sheet.worksheetTrail(owner, worksheetId, '4A(5)');
    expect(trail.decisions).toHaveLength(1);
    expect(trail.decisions[0]).toMatchObject({ documentNumber: 'INV-009', supplierName: 'ABC Pvt Ltd', reason: 'Resale', decidedByName: 'Anita' });
    expect(String(trail.decisions[0]._id)).toBe(String(decisionId));
    expect(String(trail.decisions[0].billId)).toBe(String(billId));
    const seen = await sheet.getWorksheet(owner, worksheetId);
    expect(seen.summary.itc).toBe(9000);
    expect(seen.rows.find((r) => r.key === '4C')).toMatchObject({ cgst: 4500, sgst: 4500 });
    await expect(sheet.worksheetTrail(owner, worksheetId, 'nope')).rejects.toMatchObject({ status: 404 });
  });

  it('the 3.1 row opens its tax entries; a voided bill and its void are left out, as in GSTR-1', async () => {
    await active();
    const b = await checkout(owner, await completed(), { payments: [{ method: 'CASH', amount: 105000 }] });
    const open = await checkout(owner, await completed(), { payments: [] });
    await voidInvoice(owner, open._id, { reason: 'Mistake' }, key());
    const { worksheetId } = await prepare();
    const trail = await sheet.worksheetTrail(owner, worksheetId, '3.1(a)');
    expect(trail.entries.map((e) => e.documentNumber)).toEqual([b.invoiceNumber]);
    expect(trail.entries[0].link).toBe(`/app/invoices/${b._id}`);
  });

  it('inter-state sales to unregistered customers show in 3.2 by state', async () => {
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    await issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', payments: [{ method: 'CASH', amount: 105000 }] }, key());
    const seen = await sheet.getWorksheet(owner, (await prepare()).worksheetId);
    expect(seen.rows.find((r) => r.key === '3.2:29')).toMatchObject({ table: '3.2', taxable: 100000, igst: 5000, label: expect.stringContaining('Karnataka') });
  });

  it('unresolved purchases don’t stop you looking at a draft, but block approving; so does no GSTR-2B', async () => {
    await active();
    await add();
    const first = await prepare();
    const draft = await sheet.getWorksheet(owner, first.worksheetId);
    expect(draft.status).toBe('DRAFT');
    expect(draft.notes.map((n) => n.code)).toEqual(expect.arrayContaining(['NO_VALID_2B_IMPORT', 'ITC_POLICY_UNRESOLVED', 'GSTR1_NOT_FILED']));
    await expect(sheet.approveWorksheet(owner, first.worksheetId, {}, key())).rejects.toMatchObject({ code: 'NO_VALID_2B_IMPORT' });
    await import2b();
    const second = await prepare();
    await expect(sheet.approveWorksheet(owner, second.worksheetId, {}, key())).rejects.toMatchObject({ code: 'ITC_POLICY_UNRESOLVED' });
  });

  it('something changing after preparing needs a rebuild; the old revision stays (revisions)', async () => {
    await active();
    await checkout(owner, await completed());
    const first = await prepare();
    await checkout(owner, await completed());
    expect((await sheet.getWorksheet(owner, first.worksheetId)).outOfDate).toBe(true);
    await expect(sheet.approveWorksheet(owner, first.worksheetId, {}, key())).rejects.toMatchObject({ code: 'RETURN_OUT_OF_DATE' });
    const second = await prepare();
    expect(second.revision).toBe(2);
    expect((await sheet.getWorksheet(owner, first.worksheetId)).summary.outputTax).toBe(5000);
    expect((await sheet.getWorksheet(owner, second.worksheetId)).summary.outputTax).toBe(10000);
    await expect(sheet.approveWorksheet(owner, first.worksheetId, {}, key())).rejects.toMatchObject({ code: 'RETURN_SUPERSEDED' });
  });

  it('portal figures sit beside ours: differences are explicit, point to the fix, and need a note to approve (G36)', async () => {
    await active();
    await checkout(owner, await completed());
    const { worksheetId } = await prepare();
    await sheet.savePortalFigures(owner, worksheetId, { rows: { '3.1(a)': { taxable: 100000, igst: 0, cgst: 2000, sgst: 2500 } } }, key());
    const seen = await sheet.getWorksheet(owner, worksheetId);
    expect(seen.rows.find((r) => r.key === '3.1(a)').cgst).toBe(2500); // ours are untouched
    expect(seen.portal.rows['3.1(a)'].cgst).toBe(2000);
    expect(seen.differences).toEqual([expect.objectContaining({ key: '3.1(a)', difference: { taxable: 0, igst: 0, cgst: 500, sgst: 0 }, fix: expect.stringContaining('GSTR-1A') })]);
    await expect(sheet.approveWorksheet(owner, worksheetId, {}, key())).rejects.toMatchObject({ code: 'DIFFERENCE_NOTE_REQUIRED' });
    await sheet.approveWorksheet(owner, worksheetId, { differenceNote: 'Portal rounding, confirmed with CA Mehta' }, key());
    const approved = await sheet.getWorksheet(owner, worksheetId);
    expect(approved).toMatchObject({ status: 'APPROVED', differenceNote: 'Portal rounding, confirmed with CA Mehta' });
    await expect(sheet.savePortalFigures(owner, worksheetId, { rows: {} }, key())).rejects.toMatchObject({ code: 'WORKSHEET_LOCKED' });
    await expect(sheet.savePortalFigures(owner, (await prepare()).worksheetId, { rows: { nope: { taxable: 0 } } }, key())).rejects.toMatchObject({ status: 400 });
  });

  it('what isn’t claimed is never compared with the portal', async () => {
    await active();
    const { billId } = await add();
    await import2b();
    await purchases.decideItc(owner, billId, { eligible: ZERO, reason: 'Only 5% services' }, key());
    const { worksheetId } = await prepare();
    await sheet.savePortalFigures(owner, worksheetId, { rows: { NOT_CLAIMED: { taxable: 1 } } }, key());
    expect((await sheet.getWorksheet(owner, worksheetId)).differences).toEqual([]);
  });

  it('portal figures carry over to a rebuild', async () => {
    await active();
    await checkout(owner, await completed());
    const { worksheetId } = await prepare();
    await sheet.savePortalFigures(owner, worksheetId, { rows: { '3.1(a)': { taxable: 100000, cgst: 2500, sgst: 2500 } } }, key());
    const next = await sheet.getWorksheet(owner, (await prepare()).worksheetId);
    expect(next.portal.rows['3.1(a)'].taxable).toBe(100000);
    expect(next.differences).toEqual([]);
  });

  it('filing: approved first, GSTR-1 filed first, proof needed; shown as manually confirmed, and it closes GSTR-1A and locks the month', async () => {
    await active();
    const { billId } = await add();
    await import2b();
    await purchases.decideItc(owner, billId, { eligible: ZERO, reason: 'Only 5% services' }, key());
    await checkout(owner, await completed());
    const { worksheetId } = await prepare();
    await expect(sheet.recordWorksheetFiling(owner, worksheetId, filing(), proof, key())).rejects.toMatchObject({ code: 'NOT_APPROVED' });
    await sheet.approveWorksheet(owner, worksheetId, {}, key());
    await expect(sheet.recordWorksheetFiling(owner, worksheetId, filing(), null, key())).rejects.toMatchObject({ code: 'FILING_NOT_CONFIRMED' });
    await expect(sheet.recordWorksheetFiling(owner, worksheetId, filing(), proof, key())).rejects.toMatchObject({ code: 'NOT_FILED' });
    expect((await sheet.getWorksheet(owner, worksheetId)).notes.map((n) => n.code)).toContain('GSTR1_NOT_FILED');
    const returnId = await fileGstr1();
    expect((await sheet.getWorksheet(owner, worksheetId)).notes.map((n) => n.code)).not.toContain('GSTR1_NOT_FILED');
    await expect(sheet.recordWorksheetFiling(owner, worksheetId, { ...filing(), filedOn: '2099-01-01' }, proof, key())).rejects.toMatchObject({ status: 400 });
    await sheet.recordWorksheetFiling(owner, worksheetId, filing(), proof, key());
    expect(await sheet.recordWorksheetFiling(owner, worksheetId, filing(), proof, key())).toEqual({ filed: true });

    const seen = await sheet.getWorksheet(owner, worksheetId);
    expect(seen).toMatchObject({ status: 'FILED', filing: { arn: 'AA270426123456A', confirmation: 'MANUALLY_CONFIRMED', proofName: 'ack.pdf' } });
    expect((await GstReturn.findById(returnId).lean()).gstr3b.arn).toBe('AA270426123456A');
    expect((await gstr1.filingProof(owner, seen.filing.proofFileId)).file.filename).toBe('ack.pdf');
    expect(await ActivityLog.exists({ action: 'billing.gst_3b_recorded' })).toBeTruthy();
    expect(await ActivityLog.exists({ summary: /paid/i, action: 'billing.gst_3b_recorded' })).toBeFalsy();

    // The month's purchases and credit are locked
    await expect(add({ billNumber: 'LATE-1' })).rejects.toMatchObject({ code: 'FILED_PERIOD_LOCKED' });
    await expect(import2b([])).rejects.toMatchObject({ code: 'FILED_PERIOD_LOCKED' });
    await expect(purchases.decideItc(owner, billId, { eligible: ZERO, reason: 'Change' }, key())).rejects.toMatchObject({ code: 'FILED_PERIOD_LOCKED' });
    await expect(purchases.cancelPurchase(owner, billId, { reason: 'Oops' }, key())).rejects.toMatchObject({ code: 'FILED_PERIOD_LOCKED' });
    await expect(prepare()).rejects.toMatchObject({ code: 'FILED_PERIOD_LOCKED' });
    expect((await screen()).locked).toBe(true);

    // And a correction now goes to a later-period amendment (G28)
    await checkout(owner, await completed());
    const made = await gstr1.createAdjustment(owner, returnId, { reason: 'Bill left out' }, key());
    expect(made.route).toBe('LATER_AMENDMENT');
    const month = (await gstr1.listReturns(owner, { gstin: ANDHERI_GSTIN })).months.find((m) => m.period === thisMonth());
    expect(month).toMatchObject({ worksheetStatus: 'FILED' });
    expect(String(month.worksheetId)).toBe(worksheetId);
  });

  it('inactive salons and months before the start are refused', async () => {
    await expect(prepare()).rejects.toMatchObject({ code: 'GST_NOT_ACTIVE' });
    await active();
    await expect(sheet.prepareWorksheet(owner, { gstin: ANDHERI_GSTIN, period: '2025-05' }, key())).rejects.toMatchObject({ code: 'BEFORE_START_MONTH' });
    await expect(sheet.prepareWorksheet(owner, { gstin: GSTIN('29AABCT3518Q2Z'), period: thisMonth() }, key())).rejects.toMatchObject({ status: 404 });
  });
});

// ===========================================================================
describe('Who can do what', () => {
  it('branch owners: view if delegated, work only if that is switched on too, their GSTINs only', async () => {
    await active();
    await add({ gstin: BANDRA_GSTIN });
    await add();
    const period = thisMonth();
    await expect(purchases.purchasesScreen(bandraOwner, { period })).rejects.toMatchObject({ status: 403 });
    await updateSettings(owner, { branchOwners: { viewGst: true } }, key());
    const seen = await purchases.purchasesScreen(bandraOwner, { period });
    expect(seen).toMatchObject({ gstin: BANDRA_GSTIN, canWork: false });
    await expect(purchases.purchasesScreen(bandraOwner, { gstin: ANDHERI_GSTIN, period })).rejects.toMatchObject({ status: 404 });
    await expect(add({ gstin: BANDRA_GSTIN, billNumber: 'X' }, bandraOwner)).rejects.toMatchObject({ status: 403 });
    await updateSettings(owner, { branchOwners: { approveReturns: true } }, key());
    await expect(add({ gstin: BANDRA_GSTIN, billNumber: 'X' }, bandraOwner)).resolves.toBeTruthy();
    await expect(add({ billNumber: 'Y' }, bandraOwner)).rejects.toMatchObject({ status: 404 });
    await updateSettings(owner, { branchOwners: { viewGst: false, approveReturns: false } }, key());
  });

  it('another salon can’t reach any of it (G41)', async () => {
    await active();
    const { billId } = await add();
    await checkout(owner, await completed());
    const { worksheetId } = await prepare();
    const other = { ...f.ctxDesert, userName: 'Fatima', role: 'OWNER', isPrimaryOwner: true };
    await expect(purchases.decideItc(other, billId, { eligible: ZERO, reason: 'Hack' }, key())).rejects.toMatchObject({ status: 404 });
    await expect(purchases.cancelPurchase(other, billId, { reason: 'Hack' }, key())).rejects.toMatchObject({ status: 404 });
    await expect(sheet.getWorksheet(other, worksheetId)).rejects.toMatchObject({ status: 404 });
    await expect(sheet.approveWorksheet(other, worksheetId, {}, key())).rejects.toMatchObject({ status: 404 });
    await expect(purchases.purchasesScreen(other, { gstin: ANDHERI_GSTIN, period: thisMonth() })).rejects.toMatchObject({ status: 404 });
  });
});

describe('Purchases and the working sheet through the API', () => {
  const PASSWORD = 'Password@123';
  let server;
  let api;
  const cookies = {};
  const call = async (who, method, path, body, { form } = {}) => {
    const headers = { 'idempotency-key': `test-${new mongoose.Types.ObjectId()}`, ...(form ? {} : { 'content-type': 'application/json' }) };
    if (who) headers.cookie = cookies[who];
    const res = await fetch(`${api}${path}`, { method, headers, body: form ?? (body && JSON.stringify(body)) });
    const type = res.headers.get('content-type') ?? '';
    return { status: res.status, json: type.includes('json') ? await res.json() : null };
  };
  const upload = (name, text, type = 'application/json') => {
    const data = new FormData();
    data.set('gstin', ANDHERI_GSTIN);
    data.set('period', thisMonth());
    data.set('file', new Blob([text], { type }), name);
    return data;
  };

  beforeAll(async () => {
    const g = f.ctxGlamour.orgId;
    await Organization.updateOne({ _id: g }, { $set: { 'addons.inventory.enabled': true } });
    const passwordHash = await hashPassword(PASSWORD);
    await User.create([
      { orgId: g, role: 'OWNER', name: 'Biz', email: 'biz5@g.com', passwordHash, allBranches: true },
      { orgId: g, role: 'FRONT_DESK', name: 'Desk', email: 'desk5@g.com', passwordHash, branchIds: [f.andheri._id] },
      { orgId: g, role: 'INVENTORY', name: 'Stock', email: 'stock5@g.com', passwordHash, branchIds: [f.andheri._id] },
    ]);
    server = app.listen(0);
    api = `http://127.0.0.1:${server.address().port}/api`;
    for (const [who, email] of Object.entries({ business: 'biz5@g.com', desk: 'desk5@g.com', stock: 'stock5@g.com' })) {
      const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      cookies[who] = res.headers.get('set-cookie')?.split(';')[0];
    }
  });
  afterAll(() => server?.close());

  it('the whole way through; the front desk and inventory are refused', async () => {
    await active();
    const period = thisMonth();
    const added = await call('business', 'POST', '/gst/purchases', billInput());
    expect(added.status).toBe(201);
    const imported = await call('business', 'POST', '/gst/purchases/import-2b', null, { form: upload('2b.json', JSON.stringify({ data: { gstin: ANDHERI_GSTIN, rtnprd: fp(), docdata: { b2b: [rowFor()] } } })) });
    expect(imported.json).toEqual({ alreadyImported: false, rowCount: 1 });
    expect((await call('business', 'POST', '/gst/purchases/import-2b', null, { form: upload('2b.txt', 'x', 'text/plain') })).status).toBe(400);
    const grid = (await call('business', 'GET', `/gst/purchases?gstin=${ANDHERI_GSTIN}&period=${period}`)).json;
    expect(grid.rows[0].status).toBe('MATCHED');
    const decided = await call('business', 'POST', `/gst/purchases/${added.json.billId}/decision`, { eligible: {}, reason: 'Only 5% services' });
    expect(decided.status).toBe(201);
    expect((await call('business', 'POST', `/gst/purchases/${added.json.billId}/decision`, { eligible: {}, reason: 'x' })).status).toBe(400);

    const made = await call('business', 'POST', '/gst/worksheets', { gstin: ANDHERI_GSTIN, period });
    const id = made.json.worksheetId;
    for (const who of ['desk', 'stock']) {
      expect((await call(who, 'GET', `/gst/purchases?period=${period}`)).status).toBe(403);
      expect((await call(who, 'POST', '/gst/purchases', billInput())).status).toBe(403);
      expect((await call(who, 'POST', `/gst/purchases/${added.json.billId}/decision`, { eligible: {}, reason: 'Sneak in' })).status).toBe(403);
      expect((await call(who, 'GET', `/gst/worksheets/${id}`)).status).toBe(403);
      expect((await call(who, 'POST', `/gst/worksheets/${id}/approve`, {})).status).toBe(403);
    }
    expect((await call(null, 'GET', `/gst/purchases?period=${period}`)).status).toBe(401);
    expect((await call('business', 'PUT', `/gst/worksheets/${id}/portal`, { rows: { '3.1(a)': { taxable: 0 } } })).status).toBe(200);
    expect((await call('business', 'GET', `/gst/worksheets/${id}/trail?row=NOT_CLAIMED`)).json.decisions).toHaveLength(1);
    expect((await call('business', 'POST', `/gst/worksheets/${id}/approve`, {})).status).toBe(200);

    await fileGstr1();
    const form = new FormData();
    form.set('arn', 'AA270426123456A');
    form.set('filedOn', today());
    expect((await call('business', 'POST', `/gst/worksheets/${id}/file`, null, { form })).status).toBe(400);
    form.set('proof', new Blob(['%PDF'], { type: 'application/pdf' }), 'ack.pdf');
    expect((await call('business', 'POST', `/gst/worksheets/${id}/file`, null, { form })).status).toBe(200);
    expect((await call('business', 'GET', `/gst/worksheets/${id}`)).json.status).toBe('FILED');
  });

  it('a supplier’s GSTIN is checked when saved', async () => {
    const bad = await call('business', 'POST', '/inventory/suppliers', { name: 'Bad GST', gstin: '27AABCS1429B1ZX' });
    expect(bad.status).toBe(400);
    const good = await call('business', 'POST', '/inventory/suppliers', { name: 'Good GST', gstin: SUPPLIER });
    expect(good.json.supplier.gstin).toBe(SUPPLIER);
  });
});
