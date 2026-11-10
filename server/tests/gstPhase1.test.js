// GST Phase 1: setup, dated registrations, approved tax rules, test bills and activation, bills from rules by date,
// buyer GSTIN, place of supply and IGST. The G numbers are the test numbers in the GST PRD.
import { PassThrough } from 'node:stream';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import {
  ActivityLog, Appointment, BillingSettings, CreditNote, Counter, Customer, GstRegistration, GstTaxEntry, GstTaxRule, IdempotencyRecord, InventorySku, Invoice, Organization, Payment, PaymentAllocation, Refund, Service, User,
} from '../src/models/index.js';
import { formatCreditNoteNumber, formatInvoiceNumber, gstinCheckChar } from '../src/config/billing.js';
import * as gst from '../src/modules/gst/gst.service.js';
import { lineTax } from '../src/modules/billing/tax.rules.js';
import { getSettingsForScreen, updateSettings } from '../src/modules/billing/settings.service.js';
import { runReport } from '../src/modules/billing/reports.service.js';
import { addProduct, getInvoice, issueInvoice, openDraft, quoteDraft, saveDraft } from '../src/modules/invoices/invoices.service.js';
import { writeInvoicePdf } from '../src/modules/invoices/invoice.pdf.js';
import { createRefund } from '../src/modules/refunds/refunds.service.js';
import { createSku, updateSku } from '../src/modules/inventory/skus/skus.service.js';
import { createService, updateService } from '../src/modules/services/services.service.js';
import { migrateGst } from '../src/scripts/migrate-gst-v1.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

const GSTIN = (first14) => first14 + gstinCheckChar(first14);
const MAHARASHTRA = GSTIN('27AAKCG4821M1Z');
const MAHARASHTRA_FIXED = GSTIN('27AAKCG4821M3Z');
const KARNATAKA = GSTIN('29AABCT3518Q1Z');
const today = () => DateTime.now().setZone('Asia/Kolkata').toISODate();
const tomorrow = () => DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();

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
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita1@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram1@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya1@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  const base = { ...f.ctxGlamour, addons: ['inventory'], activeBranchId: String(f.andheri._id) };
  owner = { ...base, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  bandraOwner = { ...base, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
  desk = { ...base, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };
  shampoo = (await createSku(owner, { name: 'Shampoo', category: 'Retail', stockUnit: 'bottle', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 118000, openingQty: 500 }, key())).sku;
});
afterAll(stopDb);
afterEach(() => vi.useRealTimers());
beforeEach(async () => {
  await Promise.all([BillingSettings, GstRegistration, GstTaxRule, GstTaxEntry, Appointment, Invoice, Counter, Payment, PaymentAllocation, Refund, IdempotencyRecord, CreditNote].map((m) => m.deleteMany({})));
  await Service.updateMany({}, { $set: { taxRuleGroupId: null } });
  await InventorySku.updateMany({}, { $set: { taxRuleGroupId: null } });
  await Customer.updateMany({}, { $unset: { gstin: '', gstLegalName: '' } });
});

function completed(price = 105000, { service = f.haircut, staff = f.rahul, branch = f.andheri } = {}) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: branch._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: service._id, serviceName: service.name, staffId: staff._id, staffName: staff.name, startAt: start, endAt: start, durationMinutes: 30, price }],
    startAt: start, endAt: start, totalPrice: price, status: 'COMPLETED',
  });
}

const starter = () => GstTaxRule.findOne({ orgId: f.ctxGlamour.orgId, name: 'Salon services' }).lean();
const regular = (extra = {}) => gst.saveSetup(owner, { scheme: 'REGULAR', startMonth: '2026-11', ...extra }, key());
const register = (extra = {}) => gst.addRegistration(owner, { gstin: MAHARASHTRA, legalName: 'Glamour Studio Pvt Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.andheri._id), String(f.bandra._id)], ...extra }, key());
const approve = (ruleId) => gst.approveRule(owner, String(ruleId), { reviewedBy: 'CA Mehta' }, key());

// A product rule at 18%, approved and linked to every product for sale
async function productRule() {
  const { ruleId } = await gst.createRule(owner, { name: 'Hair care products', kind: 'PRODUCT', code: '3305', rateBps: 1800, itcType: 'WITH_ITC', from: '2025-09-22' }, key());
  await approve(ruleId);
  const rule = await GstTaxRule.findById(ruleId).lean();
  await gst.linkUnlinked(owner, String(rule.groupId), key());
  return rule;
}

// Everything done, ready to activate: Save added both ready-made rules, linked; they are approved here
async function ready({ prices } = {}) {
  await regular(prices === undefined ? {} : { pricesIncludeTax: prices });
  await register();
  const rule = await starter();
  await approve(rule._id);
  const product = await GstTaxRule.findOne({ orgId: f.ctxGlamour.orgId, kind: 'PRODUCT' }).lean();
  await approve(product._id);
  return { rule, product };
}
async function active(options) {
  const parts = await ready(options);
  await gst.activate(owner, key());
  return parts;
}

// ===========================================================================
describe('The tax maths on activated salons', () => {
  const rules = { gstRegistered: true, pricesIncludeTax: true, useTaxRules: true };

  it('₹1,050 haircut at 5%: ₹1,000 + ₹25 CGST + ₹25 SGST (G03)', () => {
    expect(lineTax(105000, 500, rules)).toEqual({ taxableAmount: 100000, cgst: 2500, sgst: 2500, igst: 0, lineTotal: 105000 });
  });

  it('₹1,180 product at 18%: ₹1,000 + ₹90 + ₹90', () => {
    expect(lineTax(118000, 1800, rules)).toEqual({ taxableAmount: 100000, cgst: 9000, sgst: 9000, igst: 0, lineTotal: 118000 });
  });

  it('₹4,999 at 5% gives ₹238.05 tax, with CGST and SGST 1 paisa apart (decision 3)', () => {
    expect(lineTax(499900, 500, rules)).toEqual({ taxableAmount: 476095, cgst: 11903, sgst: 11902, igst: 0, lineTotal: 499900 });
  });

  it('a salon that has not activated keeps the equal halves it has today', () => {
    expect(lineTax(499900, 500, { gstRegistered: true, pricesIncludeTax: true })).toEqual({ taxableAmount: 476096, cgst: 11902, sgst: 11902, lineTotal: 499900 });
  });

  it('another state is all IGST, and it adds up on top of the price too', () => {
    expect(lineTax(105000, 500, { ...rules, interstate: true })).toEqual({ taxableAmount: 100000, cgst: 0, sgst: 0, igst: 5000, lineTotal: 105000 });
    expect(lineTax(100000, 500, { ...rules, pricesIncludeTax: false })).toEqual({ taxableAmount: 100000, cgst: 2500, sgst: 2500, igst: 0, lineTotal: 105000 });
  });

  it('every prefix the app allows fits the 16-character limit on GST numbers', () => {
    for (const prefix of ['A', 'AB', 'ABC', 'ABCD']) {
      expect(formatInvoiceNumber(prefix, '26-27', 99999).length).toBeLessThanOrEqual(16);
      expect(formatCreditNoteNumber(prefix, '26-27', 999).length).toBeLessThanOrEqual(16);
    }
  });
});

// ===========================================================================
describe('Registration type', () => {
  it('composition and QRMP are refused (G44)', async () => {
    await expect(gst.saveSetup(owner, { scheme: 'COMPOSITION' }, key())).rejects.toMatchObject({ code: 'REGIME_NOT_SUPPORTED' });
    await expect(gst.saveSetup(owner, { scheme: 'QRMP' }, key())).rejects.toMatchObject({ code: 'REGIME_NOT_SUPPORTED' });
    expect(await BillingSettings.countDocuments({ 'gst.scheme': { $in: ['COMPOSITION', 'QRMP'] } })).toBe(0);
  });

  it('choosing Regular adds ready-made draft rules for services and products, once, linked to everything', async () => {
    await regular();
    await regular();
    const rules = await GstTaxRule.find({ orgId: f.ctxGlamour.orgId }).sort({ kind: -1 }).lean();
    expect(rules).toHaveLength(2);
    expect(rules[0]).toMatchObject({ name: 'Salon services', kind: 'SERVICE', rateBps: 500, itcType: 'WITHOUT_ITC', from: '2025-09-22', status: 'DRAFT', code: '999721' });
    expect(rules[1]).toMatchObject({ name: 'Products for sale', kind: 'PRODUCT', rateBps: 1800, itcType: 'WITH_ITC', from: '2025-09-22', status: 'DRAFT', code: '3305' });
    expect((await gst.getSetup(owner)).unlinked).toEqual({ SERVICE: 0, PRODUCT: 0 });
    expect((await InventorySku.findById(shampoo._id).lean()).taxRuleGroupId).toEqual(rules[1].groupId);
  });

  it('the product rule takes the HSN code products already have, and Save fills in this month when none is sent', async () => {
    const sku = await InventorySku.findById(shampoo._id).lean();
    await updateSku(owner, shampoo._id, { version: sku.version, hsnCode: '33059011' }, key());
    await gst.saveSetup(owner, { scheme: 'REGULAR' }, key());
    expect((await GstTaxRule.findOne({ orgId: f.ctxGlamour.orgId, kind: 'PRODUCT' }).lean()).code).toBe('33059011');
    expect((await gst.getSetup(owner)).startMonth).toBe(DateTime.now().setZone('Asia/Kolkata').toFormat('yyyy-MM'));
    const after = await InventorySku.findById(shampoo._id).lean();
    await updateSku(owner, shampoo._id, { version: after.version, hsnCode: null }, key());
  });

  it('before Save, the only thing asked is to choose Regular', async () => {
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: MAHARASHTRA, stateCode: '27' }] });
    const { scheme, checks } = await gst.getSetup(owner);
    expect(scheme).toBe('REGULAR');
    expect(checks.map((c) => c.code)).toEqual(['REGIME_NOT_SUPPORTED']);
  });

  it('choosing Regular does not change billing until the salon activates', async () => {
    await regular();
    const bill = await checkout(owner, await completed());
    expect(bill).toMatchObject({ gstRegistered: false, gstSetupActive: false, taxTotal: 0, grandTotal: 105000 });
  });
});

// ===========================================================================
describe('GST registrations', () => {
  it('a wrong GSTIN or the wrong state is refused, naming the field (G02)', async () => {
    await expect(register({ gstin: '27AAKCG4821M1ZX' })).rejects.toMatchObject({ code: 'REGISTRATION_INVALID', details: { field: 'gstin' } });
    await expect(register({ stateCode: '29' })).rejects.toMatchObject({ code: 'REGISTRATION_INVALID', details: { field: 'stateCode' } });
    expect(await GstRegistration.countDocuments()).toBe(0);
  });

  it('two GSTINs for one branch on the same date are refused', async () => {
    await register();
    await expect(register({ gstin: MAHARASHTRA_FIXED, from: '2026-01-01' })).rejects.toMatchObject({ code: 'BRANCH_MAPPING_CONFLICT' });
    expect(await GstRegistration.countDocuments()).toBe(1);
  });

  it('fixing a GSTIN adds a new dated row and keeps the old one', async () => {
    await register();
    await register({ gstin: MAHARASHTRA_FIXED, from: '2026-04-01', move: true });
    const [oldRow, newRow] = await GstRegistration.find().sort({ from: 1 }).lean();
    expect(oldRow).toMatchObject({ gstin: MAHARASHTRA, from: '2025-01-01', to: '2026-03-31' });
    expect(oldRow.branches.every((b) => b.to === '2026-03-31')).toBe(true);
    expect(newRow).toMatchObject({ gstin: MAHARASHTRA_FIXED, from: '2026-04-01', to: null });
    // Billing settings show today's GSTIN
    const screen = await getSettingsForScreen(owner);
    expect(screen.branches.map((b) => b.gstin)).toEqual([MAHARASHTRA_FIXED, MAHARASHTRA_FIXED]);
  });

  it('a GSTIN can’t be moved back over bills already issued under it', async () => {
    await active();
    await checkout(owner, await completed());
    await expect(register({ gstin: MAHARASHTRA_FIXED, from: today(), move: true })).rejects.toMatchObject({ code: 'BILLS_UNDER_OLD_GSTIN' });
    await expect(register({ gstin: MAHARASHTRA_FIXED, from: tomorrow(), move: true })).resolves.toBeTruthy();
  });

  it('a branch can be linked to an existing registration, without overlapping', async () => {
    const { registrationId } = await register({ branchIds: [String(f.andheri._id)] });
    await expect(gst.linkBranch(owner, registrationId, { branchId: String(f.bandra._id), from: '2024-01-01' }, key())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await gst.linkBranch(owner, registrationId, { branchId: String(f.bandra._id), from: '2026-01-01' }, key());
    await expect(gst.linkBranch(owner, registrationId, { branchId: String(f.bandra._id), from: '2026-06-01' }, key())).rejects.toMatchObject({ code: 'BRANCH_MAPPING_CONFLICT' });
  });

  it('existing branch GSTINs move over automatically, once only, and bills never change', async () => {
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: MAHARASHTRA, stateCode: '27', invoicePrefix: 'AND' }, { branchId: f.bandra._id, gstin: MAHARASHTRA, stateCode: '27' }] });
    const bill = await checkout(owner, await completed(118000));
    expect((await migrateGst({ log: () => {} })).moved).toBe(2);
    expect((await migrateGst({ log: () => {} })).moved).toBe(0);
    const rows = await GstRegistration.find({ orgId: f.ctxGlamour.orgId }).lean();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ gstin: MAHARASHTRA, legalName: 'Glamour Pvt Ltd', stateCode: '27' });
    expect(rows[0].branches).toHaveLength(2);
    expect(await getInvoice(owner, bill._id)).toMatchObject({ grandTotal: bill.grandTotal, taxTotal: bill.taxTotal });
  });

  it('Billing settings no longer change a GSTIN, but a prefix can still be saved without losing it', async () => {
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: MAHARASHTRA, stateCode: '27' }] });
    await migrateGst({ log: () => {} });
    await expect(updateSettings(owner, { branches: [{ branchId: String(f.andheri._id), gstin: MAHARASHTRA_FIXED }] }, key())).rejects.toMatchObject({ code: 'USE_GST_SETUP' });
    await updateSettings(owner, { branches: [{ branchId: String(f.andheri._id), invoicePrefix: 'GLM' }] }, key());
    const screen = await getSettingsForScreen(owner);
    expect(screen.branches.find((b) => String(b.branchId) === String(f.andheri._id))).toMatchObject({ gstin: MAHARASHTRA, invoicePrefix: 'GLM' });
  });
});

// ===========================================================================
describe('Tax rules', () => {
  it('only an approved rule counts, and approving records who reviewed it', async () => {
    await regular();
    const rule = await starter();
    await expect(gst.approveRule(bandraOwner, String(rule._id), { reviewedBy: 'Me' }, key())).rejects.toMatchObject({ status: 403 });
    await approve(rule._id);
    expect(await starter()).toMatchObject({ status: 'APPROVED', reviewedBy: 'CA Mehta', approvedByName: 'Anita' });
    expect(await ActivityLog.exists({ orgId: f.ctxGlamour.orgId, action: 'billing.gst_rule_approved' })).toBeTruthy();
  });

  it('an approved rule can’t be edited or deleted; a draft can', async () => {
    await regular();
    const rule = await starter();
    await gst.updateRule(owner, String(rule._id), { code: '999722' }, key());
    expect((await starter()).code).toBe('999722');
    await approve(rule._id);
    await expect(gst.updateRule(owner, String(rule._id), { rateBps: 1800 }, key())).rejects.toMatchObject({ code: 'RULE_LOCKED' });
    await expect(gst.deleteRule(owner, String(rule._id), key())).rejects.toMatchObject({ code: 'RULE_LOCKED' });
    expect((await starter()).rateBps).toBe(500);
  });

  it('overlapping dates are refused', async () => {
    await regular();
    const rule = await starter();
    await approve(rule._id);
    const groupId = String(rule.groupId);
    const change = (dates) => gst.createRule(owner, { groupId, code: '999721', rateBps: 1800, itcType: 'WITH_ITC', ...dates }, key());
    await expect(change({ from: '2025-09-22' })).rejects.toMatchObject({ code: 'RULE_OVERLAP' }); // same start
    await expect(change({ from: '2025-01-01' })).rejects.toMatchObject({ code: 'RULE_OVERLAP' }); // before it, with no end
    const { ruleId } = await change({ from: '2026-01-01' });
    await expect(change({ from: '2026-02-01' })).rejects.toMatchObject({ code: 'RULE_OVERLAP' }); // clashes with the new draft
    await approve(ruleId);
    await expect(change({ from: '2025-12-01', to: '2026-02-01' })).rejects.toMatchObject({ code: 'RULE_OVERLAP' });
    // The older rule ended the day before the new one, and nothing else about it changed
    expect(await GstTaxRule.findById(rule._id).lean()).toMatchObject({ to: '2025-12-31', rateBps: 500, status: 'APPROVED' });
  });

  it('a new rate can’t start on a day bills already used the old one', async () => {
    const { rule } = await active();
    await checkout(owner, await completed());
    const { ruleId } = await gst.createRule(owner, { groupId: String(rule.groupId), code: '999721', rateBps: 1800, itcType: 'WITH_ITC', from: today() }, key());
    await expect(approve(ruleId)).rejects.toMatchObject({ code: 'RULE_ALREADY_USED' });
    expect((await GstTaxRule.findById(rule._id).lean()).to).toBe(null);
  });

  it('a service or product can only point at a rule of its own kind, in this salon, set by an owner', async () => {
    await regular();
    const { groupId } = await starter();
    const group = String(groupId);
    const product = await productRule();
    await expect(updateService(owner, f.haircut._id, { taxRuleGroupId: String(product.groupId) })).rejects.toMatchObject({ status: 400 });
    await expect(updateService(owner, f.haircut._id, { taxRuleGroupId: String(new mongoose.Types.ObjectId()) })).rejects.toMatchObject({ status: 400 });
    await expect(updateService(desk, f.haircut._id, { taxRuleGroupId: group })).rejects.toMatchObject({ status: 403 });
    expect((await updateService(owner, f.haircut._id, { taxRuleGroupId: group })).taxRuleGroupId).toEqual(groupId);
    const made = await createService(owner, { name: 'Head massage', price: 30000, taxRuleGroupId: group });
    expect(made.taxRuleGroupId).toEqual(groupId);
    await Service.deleteOne({ _id: made._id });
    const sku = await InventorySku.findById(shampoo._id).lean();
    await expect(updateSku(owner, shampoo._id, { version: sku.version, taxRuleGroupId: group }, key())).rejects.toMatchObject({ status: 400 });
    await expect(updateSku(owner, shampoo._id, { version: sku.version, taxRuleGroupId: String(product.groupId) }, key())).resolves.toBeTruthy();
  });

  it('links every service with no rule yet, in one go', async () => {
    await regular();
    const { groupId } = await starter();
    await Service.updateMany({}, { $set: { taxRuleGroupId: null } });
    const { linked } = await gst.linkUnlinked(owner, String(groupId), key());
    expect(linked).toBe(3);
    expect((await gst.getSetup(owner)).unlinked.SERVICE).toBe(0);
  });
});

// ===========================================================================
describe('Test bills and activation', () => {
  it('a test bill shows the tax, saves no bill, and a draft rule doesn’t count', async () => {
    await regular();
    await register();
    const rule = await starter();
    const lines = [{ groupId: String(rule.groupId), unitPrice: 105000, qty: 1 }];
    const draftRule = await gst.testBill(owner, { branchId: String(f.andheri._id), lines });
    expect(draftRule.blockers.map((b) => b.code)).toEqual(['TAX_CLASSIFICATION_MISSING']);

    await approve(rule._id);
    const sample = await gst.testBill(owner, { branchId: String(f.andheri._id), lines });
    expect(sample.blockers).toEqual([]);
    expect(sample.totals).toMatchObject({ taxableTotal: 100000, cgstTotal: 2500, sgstTotal: 2500, igstTotal: 0, grandTotal: 105000 });
    const away = await gst.testBill(owner, { branchId: String(f.andheri._id), placeOfSupply: '29', lines });
    expect(away).toMatchObject({ interstate: true, placeOfSupply: { stateCode: '29', stateName: 'Karnataka' } });
    expect(away.totals).toMatchObject({ cgstTotal: 0, sgstTotal: 0, igstTotal: 5000 });
    expect(await Invoice.countDocuments()).toBe(0);
  });

  it('activation is refused until every check passes, and says what is wrong', async () => {
    await expect(gst.activate(owner, key())).rejects.toMatchObject({ code: 'GST_CONFIGURATION_INCOMPLETE' });
    await regular({ startMonth: '' });
    await Service.updateMany({}, { $set: { taxRuleGroupId: null } });
    const { checks } = await gst.getSetup(owner);
    const failed = checks.filter((c) => !c.ok).map((c) => c.code);
    expect(failed).toEqual(expect.arrayContaining(['START_MONTH_MISSING', 'BRANCH_MAPPING_MISSING', 'TAX_CLASSIFICATION_MISSING']));
    await expect(gst.activate(owner, key())).rejects.toMatchObject({ code: 'GST_CONFIGURATION_INCOMPLETE' });
    expect((await gst.getSetup(owner)).active).toBe(false);
  });

  it('Save, then Activate: activating approves the ready-made rules, and the reviewer is optional', async () => {
    await regular();
    await register();
    const setup = await gst.getSetup(owner);
    expect(setup.checks.every((c) => c.ok)).toBe(true);
    expect(setup.toApprove.map((r) => r.name).sort()).toEqual(['Products for sale', 'Salon services']);
    await gst.activate(owner, key());
    const rules = await GstTaxRule.find({ orgId: f.ctxGlamour.orgId }).lean();
    expect(rules.every((r) => r.status === 'APPROVED' && r.approvedByName === 'Anita')).toBe(true);
    expect((await gst.getSetup(owner)).toApprove).toEqual([]);
    const bill = await checkout(owner, await completed());
    expect(bill).toMatchObject({ gstSetupActive: true, taxTotal: 5000 });
    // Once active, a new draft has to be approved by hand
    const { ruleId } = await gst.createRule(owner, { groupId: String(rules.find((r) => r.kind === 'SERVICE').groupId), code: '999721', rateBps: 1800, itcType: 'WITH_ITC', from: tomorrow() }, key());
    await gst.approveRule(owner, ruleId, {}, key());
    expect(await GstTaxRule.findById(ruleId).lean()).toMatchObject({ status: 'APPROVED', reviewedBy: null });
  });

  it('a bad GSTIN that came from old settings blocks activation by name (G02)', async () => {
    await ready();
    await GstRegistration.updateMany({}, { $set: { gstin: '27AAKCG4821M1ZX' } });
    await expect(gst.activate(owner, key())).rejects.toMatchObject({ code: 'REGISTRATION_INVALID', message: expect.stringContaining('27AAKCG4821M1ZX') });
  });

  it('a regular salon with everything approved activates (G01), and the setup is kept in the log', async () => {
    await active();
    const setup = await gst.getSetup(owner);
    expect(setup).toMatchObject({ active: true, scheme: 'REGULAR', startMonth: '2026-11', activatedByName: 'Anita' });
    expect(setup.checks.every((c) => c.ok)).toBe(true);
    const log = await ActivityLog.findOne({ orgId: f.ctxGlamour.orgId, action: 'billing.gst_activated' }).lean();
    expect(log.after.registrations[0].gstin).toBe(MAHARASHTRA);
    expect(log.after.rules.map((r) => r.rateBps).sort()).toEqual([1800, 500]);
  });

  it('after activating, the start month and "GST registered" can’t be changed by accident', async () => {
    await active();
    await expect(regular({ startMonth: '2026-12' })).rejects.toMatchObject({ code: 'START_MONTH_LOCKED' });
    await expect(updateSettings(owner, { gstRegistered: false }, key())).rejects.toMatchObject({ code: 'USE_GST_SETUP' });
    await expect(gst.saveSetup(owner, { scheme: 'UNREGISTERED' }, key())).rejects.toMatchObject({ code: 'REASON_REQUIRED' });
  });

  it('a salon that stops being registered goes back to plain bills, with a reason', async () => {
    await active();
    await gst.saveSetup(owner, { scheme: 'UNREGISTERED', reason: 'Registration cancelled' }, key());
    expect((await gst.getSetup(owner)).active).toBe(false);
    const bill = await checkout(owner, await completed());
    expect(bill).toMatchObject({ gstRegistered: false, gstSetupActive: false, taxTotal: 0, grandTotal: 105000 });
  });
});

// ===========================================================================
describe('Bills after activation', () => {
  it('₹1,050 haircut: ₹1,000 + ₹25 + ₹25, with the rule, code and GSTIN saved on the bill (G03)', async () => {
    const { rule } = await active();
    const bill = await checkout(desk, await completed());
    expect(bill).toMatchObject({ gstRegistered: true, gstSetupActive: true, interstate: false, taxableTotal: 100000, cgstTotal: 2500, sgstTotal: 2500, igstTotal: 0, grandTotal: 105000, taxDate: today() });
    expect(bill.lines[0]).toMatchObject({ taxRateBps: 500, sacCode: '999721', taxRuleName: 'Salon services', itcType: 'WITHOUT_ITC' });
    expect(String(bill.lines[0].taxRuleId)).toBe(String(rule._id));
    expect(bill.seller).toMatchObject({ gstin: MAHARASHTRA, legalName: 'Glamour Studio Pvt Ltd', stateCode: '27', stateName: 'Maharashtra' });
    expect(bill.placeOfSupply).toMatchObject({ stateCode: '27', stateName: 'Maharashtra', chosen: false });
  });

  it('₹1,180 product with an approved 18% rule: ₹1,000 + ₹90 + ₹90, and mixed rates stay in separate rows with an exact total (G05, G07)', async () => {
    await active();
    const appt = await completed();
    const draft = await openDraft(owner, { appointmentId: appt._id });
    const withProduct = await addProduct(owner, draft._id, { version: draft.version, skuId: String(shampoo._id), qty: 1 });
    const product = withProduct.lines.find((l) => l.kind === 'PRODUCT');
    expect(product).toMatchObject({ taxableAmount: 100000, cgst: 9000, sgst: 9000, taxRateBps: 1800, hsnCode: '3305' });
    expect(withProduct.taxSummary).toEqual([
      expect.objectContaining({ rateBps: 500, taxableAmount: 100000, cgst: 2500, sgst: 2500 }),
      expect.objectContaining({ rateBps: 1800, taxableAmount: 100000, cgst: 9000, sgst: 9000 }),
    ]);
    expect(withProduct.grandTotal).toBe(223000);

    // A ₹100 bill discount is shared by the lines' amounts, tax follows, and everything adds up to the paisa
    const edits = { billDiscount: { type: 'flat', value: 10000 } };
    const priced = await quoteDraft(owner, draft._id, edits);
    expect(priced.lines.map((l) => l.billDiscountShare).reduce((a, b) => a + b)).toBe(10000);
    expect(priced.grandTotal).toBe(213000);
    expect(priced.lines.reduce((sum, l) => sum + l.taxableAmount + l.cgst + l.sgst, 0)).toBe(213000);
    expect(priced.taxableTotal + priced.taxTotal).toBe(priced.grandTotal);
  });

  it('prices without GST: tax is added on top', async () => {
    await active({ prices: false });
    const bill = await checkout(desk, await completed(100000));
    expect(bill).toMatchObject({ pricesIncludeTax: false, taxableTotal: 100000, cgstTotal: 2500, sgstTotal: 2500, grandTotal: 105000 });
  });

  it('another state gives IGST with no CGST or SGST, on the bill, tax table, report and PDF (G04)', async () => {
    await active();
    const appt = await completed();
    const draft = await openDraft(owner, { appointmentId: appt._id });
    const bill = await issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', payments: [{ method: 'CASH', amount: 105000 }] }, key());
    expect(bill).toMatchObject({ interstate: true, taxableTotal: 100000, cgstTotal: 0, sgstTotal: 0, igstTotal: 5000, taxTotal: 5000, grandTotal: 105000 });
    expect(bill.lines[0]).toMatchObject({ cgst: 0, sgst: 0, igst: 5000 });
    expect(bill.taxSummary).toEqual([expect.objectContaining({ rateBps: 500, taxableAmount: 100000, cgst: 0, sgst: 0, igst: 5000 })]);
    expect(bill.placeOfSupply).toMatchObject({ stateCode: '29', stateName: 'Karnataka', chosen: true });

    const report = await runReport(owner, 'gst', {});
    expect(report.columns.map((c) => c.key)).toContain('netIgst');
    expect(report.totals).toMatchObject({ igst: 5000, netIgst: 5000, cgst: 0 });

    const pdf = await new Promise((resolve) => {
      const out = new PassThrough();
      const chunks = [];
      out.on('data', (c) => chunks.push(c));
      out.on('end', () => resolve(Buffer.concat(chunks)));
      writeInvoicePdf(out, bill);
    });
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
  });

  it('a bill with IGST refunds as IGST, on a credit note', async () => {
    await active();
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    const bill = await issueInvoice(owner, draft._id, { version: draft.version, placeOfSupply: '29', payments: [{ method: 'CASH', amount: 105000 }] }, key());
    const { refund } = await createRefund(owner, { invoiceId: bill._id, lines: [{ lineId: String(bill.lines[0]._id), qty: 1 }], reason: 'Customer unhappy' }, key());
    expect(refund.lines[0]).toMatchObject({ taxableAmount: 100000, cgst: 0, sgst: 0, igst: 5000, amount: 105000 });
    const note = await CreditNote.findById(refund.creditNoteId).lean();
    expect(note).toMatchObject({ taxableTotal: 100000, cgstTotal: 0, sgstTotal: 0, igstTotal: 5000, total: 105000, placeOfSupply: { stateCode: '29' } });
    expect(note.lines[0].igst).toBe(5000);
    expect((await runReport(owner, 'gst', {})).totals).toMatchObject({ creditIgst: 5000, netIgst: 0 });
  });

  it('a customer’s GSTIN is printed on their bill; the place of supply stays the branch’s state unless an owner changes it', async () => {
    await active();
    await Customer.updateOne({ _id: f.priya._id }, { $set: { gstin: KARNATAKA, gstLegalName: 'Priya Beauty LLP' } });
    const bill = await checkout(desk, await completed());
    expect(bill.buyer).toMatchObject({ gstin: KARNATAKA, legalName: 'Priya Beauty LLP' });
    expect(bill).toMatchObject({ interstate: false, cgstTotal: 2500 });
  });

  it('only an owner can change the place of supply, and the change is logged', async () => {
    await active();
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    await expect(quoteDraft(desk, draft._id, { placeOfSupply: '29' })).rejects.toMatchObject({ status: 403 });
    const saved = await saveDraft(owner, draft._id, { version: draft.version, placeOfSupply: '29' });
    expect(saved.placeOfSupply).toMatchObject({ stateCode: '29', chosen: true });
    expect(await ActivityLog.exists({ action: 'billing.place_of_supply_changed', invoiceId: draft._id })).toBeTruthy();
    // The desk can finish the bill the owner set up, and it stays IGST
    const quote = await quoteDraft(desk, draft._id, {});
    expect(quote).toMatchObject({ interstate: true, igstTotal: 5000 });
    const bill = await issueInvoice(desk, draft._id, { version: saved.version, payments: [{ method: 'CASH', amount: 105000 }] }, key());
    expect(bill.igstTotal).toBe(5000);
  });

  it('a line with no approved rule can’t be issued, and the error links to the service to fix (G06)', async () => {
    await active();
    await Service.updateOne({ _id: f.haircut._id }, { $set: { taxRuleGroupId: null } });
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const quote = await quoteDraft(desk, draft._id, {});
    expect(quote.gstBlockers[0]).toMatchObject({ code: 'TAX_CLASSIFICATION_MISSING', link: `/app/catalog?service=${f.haircut._id}` });
    await expect(issueInvoice(desk, draft._id, { version: draft.version, payments: [] }, key())).rejects.toMatchObject({ code: 'TAX_CLASSIFICATION_MISSING' });
    expect((await Invoice.findById(draft._id).lean()).status).toBe('DRAFT'); // never issued with tax as zero
  });

  it('a product with no approved rule links to the product to fix', async () => {
    await active();
    await InventorySku.updateOne({ _id: shampoo._id }, { $set: { taxRuleGroupId: null } });
    const draft = await openDraft(owner, { appointmentId: (await completed())._id });
    await addProduct(owner, draft._id, { version: draft.version, skuId: String(shampoo._id), qty: 1 });
    const quote = await quoteDraft(owner, draft._id, {});
    expect(quote.gstBlockers[0].link).toContain(`product=${shampoo._id}`);
  });

  it('a branch with no GSTIN on that date is blocked: the place of supply is never assumed (G45)', async () => {
    await active();
    await GstRegistration.updateMany({}, { $set: { 'branches.$[].to': '2025-06-30', 'branches.$[].from': '2025-01-01' } });
    const draft = await openDraft(desk, { appointmentId: (await completed())._id });
    const quote = await quoteDraft(desk, draft._id, {});
    expect(quote.gstBlockers.map((b) => b.code)).toEqual(expect.arrayContaining(['GSTIN_MISSING', 'PLACE_OF_SUPPLY_UNRESOLVED']));
    expect(quote.placeOfSupply.stateCode).toBe(null);
    await expect(issueInvoice(desk, draft._id, { version: draft.version, payments: [] }, key())).rejects.toMatchObject({ code: 'GSTIN_MISSING' });
  });

  it('a rate change affects new bills only: the old bill keeps its saved tax (G43)', async () => {
    const { rule } = await active();
    const oldBill = await checkout(desk, await completed());
    const { ruleId } = await gst.createRule(owner, { groupId: String(rule.groupId), code: '999721', rateBps: 1800, itcType: 'WITH_ITC', from: tomorrow() }, key());
    await approve(ruleId);

    // Still 5% today, 18% from tomorrow
    const lines = [{ groupId: String(rule.groupId), unitPrice: 118000, qty: 1 }];
    expect((await gst.testBill(owner, { branchId: String(f.andheri._id), lines })).lines[0].rateBps).toBe(500);
    expect((await gst.testBill(owner, { branchId: String(f.andheri._id), date: tomorrow(), lines })).lines[0].rateBps).toBe(1800);

    vi.useFakeTimers({ toFake: ['Date'], now: DateTime.now().plus({ days: 1 }).toJSDate() });
    const newBill = await checkout(desk, await completed(118000));
    expect(newBill).toMatchObject({ taxableTotal: 100000, cgstTotal: 9000, sgstTotal: 9000 });
    expect(newBill.lines[0].taxRateBps).toBe(1800);
    expect(await getInvoice(owner, oldBill._id)).toMatchObject({ taxableTotal: 100000, cgstTotal: 2500, sgstTotal: 2500, grandTotal: 105000 });
  });

  it('a corrected GSTIN applies to new bills from its date; old bills keep theirs', async () => {
    await active();
    const oldBill = await checkout(desk, await completed());
    await register({ gstin: MAHARASHTRA_FIXED, from: tomorrow(), move: true });
    vi.useFakeTimers({ toFake: ['Date'], now: DateTime.now().plus({ days: 1 }).toJSDate() });
    const newBill = await checkout(desk, await completed());
    expect(newBill.seller.gstin).toBe(MAHARASHTRA_FIXED);
    expect((await getInvoice(owner, oldBill._id)).seller.gstin).toBe(MAHARASHTRA);
  });
});

// ===========================================================================
describe('Salons that have not activated bill exactly as before', () => {
  it('not registered: plain bills', async () => {
    const bill = await checkout(desk, await completed());
    expect(bill).toMatchObject({ gstRegistered: false, gstSetupActive: false, interstate: false, taxTotal: 0, grandTotal: 105000 });
    expect(bill.lines[0].taxRuleId).toBe(null);
  });

  it('registered in Billing settings: their own rates and the equal halves, even with approved rules waiting', async () => {
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: MAHARASHTRA, stateCode: '27' }] });
    await regular();
    const rule = await starter();
    await approve(rule._id);
    await gst.linkUnlinked(owner, String(rule.groupId), key());
    const bill = await checkout(desk, await completed(118000));
    expect(bill).toMatchObject({ gstSetupActive: false, taxableTotal: 100000, cgstTotal: 9000, sgstTotal: 9000 }); // the 18% default
    expect(bill.lines[0].taxRateBps).toBe(1800);
    expect(bill.placeOfSupply).toBe(null);
    expect(bill.buyer?.gstin).toBeUndefined();
  });

  it('no IGST columns in the report when there is no IGST', async () => {
    await BillingSettings.create({ orgId: f.ctxGlamour.orgId, legalName: 'Glamour Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: MAHARASHTRA, stateCode: '27' }] });
    await checkout(desk, await completed(118000));
    const report = await runReport(owner, 'gst', {});
    expect(report.columns.map((c) => c.key)).not.toContain('igst');
  });
});

// ===========================================================================
describe('Who can do what', () => {
  it('branch owners can look but change nothing', async () => {
    await regular();
    const rule = await starter();
    expect(await gst.getSetup(bandraOwner)).toMatchObject({ canEdit: false });
    await expect(gst.saveSetup(bandraOwner, { scheme: 'REGULAR' }, key())).rejects.toMatchObject({ status: 403 });
    await expect(gst.addRegistration(bandraOwner, { gstin: MAHARASHTRA, legalName: 'X Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.bandra._id)] }, key())).rejects.toMatchObject({ status: 403 });
    await expect(gst.createRule(bandraOwner, { name: 'X', kind: 'SERVICE', code: '999721', rateBps: 500, itcType: 'WITHOUT_ITC', from: '2026-01-01' }, key())).rejects.toMatchObject({ status: 403 });
    await expect(gst.linkUnlinked(bandraOwner, String(rule.groupId), key())).rejects.toMatchObject({ status: 403 });
    await expect(gst.activate(bandraOwner, key())).rejects.toMatchObject({ status: 403 });
    await expect(gst.testBill(bandraOwner, { branchId: String(f.bandra._id), lines: [] })).rejects.toMatchObject({ status: 403 });
  });

  it('a branch owner only sees registrations of their own branches', async () => {
    await register({ branchIds: [String(f.andheri._id)] });
    expect((await gst.getSetup(owner)).registrations).toHaveLength(1);
    expect((await gst.getSetup(bandraOwner)).registrations).toHaveLength(0);
  });

  it('another salon’s records simply don’t exist', async () => {
    await regular();
    const rule = await starter();
    const { registrationId } = await register();
    const other = { ...f.ctxDesert, userName: 'Omar', role: 'OWNER', isPrimaryOwner: true };
    await expect(gst.approveRule(other, String(rule._id), { reviewedBy: 'Me' }, key())).rejects.toMatchObject({ status: 404 });
    await expect(gst.updateRule(other, String(rule._id), { rateBps: 0 }, key())).rejects.toMatchObject({ status: 404 });
    await expect(gst.linkUnlinked(other, String(rule.groupId), key())).rejects.toMatchObject({ status: 404 });
    await expect(gst.linkBranch(other, registrationId, { branchId: String(f.marina._id), from: '2026-01-01' }, key())).rejects.toMatchObject({ status: 404 });
    await expect(gst.addRegistration(other, { gstin: MAHARASHTRA, legalName: 'X Ltd', stateCode: '27', from: '2025-01-01', branchIds: [String(f.andheri._id)] }, key())).rejects.toMatchObject({ status: 404 });
    expect((await gst.getSetup(other)).registrations).toHaveLength(0);
    expect((await gst.getSetup(other)).groups).toHaveLength(0);
  });
});

// Through the real API: each role's way in
describe('GST setup through the API', () => {
  const PASSWORD = 'Password@123';
  let server;
  let api;
  const cookies = {};
  const call = async (who, method, path, body) => {
    const headers = { 'content-type': 'application/json', 'idempotency-key': `test-${new mongoose.Types.ObjectId()}` };
    if (who) headers.cookie = cookies[who];
    const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => null) };
  };

  beforeAll(async () => {
    const g = f.ctxGlamour.orgId;
    await Organization.updateOne({ _id: g }, { $set: { 'addons.inventory.enabled': true } });
    const passwordHash = await hashPassword(PASSWORD);
    await User.create([
      { orgId: g, role: 'OWNER', name: 'Biz', email: 'biz@g.com', passwordHash, allBranches: true },
      { orgId: g, role: 'OWNER', name: 'Bran', email: 'bran@g.com', passwordHash, branchIds: [f.bandra._id] },
      { orgId: g, role: 'FRONT_DESK', name: 'Desk', email: 'desk@g.com', passwordHash, branchIds: [f.andheri._id] },
      { orgId: g, role: 'INVENTORY', name: 'Stock', email: 'stock@g.com', passwordHash, branchIds: [f.andheri._id] },
    ]);
    server = app.listen(0);
    api = `http://127.0.0.1:${server.address().port}/api`;
    for (const [who, email] of Object.entries({ business: 'biz@g.com', branch: 'bran@g.com', desk: 'desk@g.com', stock: 'stock@g.com' })) {
      const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
      cookies[who] = res.headers.get('set-cookie')?.split(';')[0];
    }
  });
  afterAll(() => server?.close());

  it.each([
    ['look at setup', 'GET', '/gst/setup', undefined, { business: 200, branch: 200, desk: 403, stock: 403 }],
    ['look at rules', 'GET', '/gst/rules', undefined, { business: 200, branch: 200, desk: 403, stock: 403 }],
    ['change setup', 'PATCH', '/gst/setup', { scheme: 'REGULAR', startMonth: '2026-11' }, { business: 200, branch: 403, desk: 403, stock: 403 }],
    ['activate', 'POST', '/gst/activate', undefined, { business: 409, branch: 403, desk: 403, stock: 403 }],
  ])('%s', async (_label, method, path, body, expected) => {
    for (const [who, status] of Object.entries(expected)) {
      expect([who, (await call(who, method, path, body)).status]).toEqual([who, status]);
    }
    expect((await call(null, method, path, body)).status).toBe(401);
  });

  it('checks what is sent: unsupported types, a short GSTIN and a bad rate are refused', async () => {
    expect((await call('business', 'PATCH', '/gst/setup', { scheme: 'COMPOSITION' })).status).toBe(400);
    expect((await call('business', 'POST', '/gst/registrations', { gstin: '27AAK', legalName: 'X Ltd', stateCode: '27', from: '2026-01-01', branchIds: [String(f.andheri._id)] })).status).toBe(400);
    expect((await call('business', 'POST', '/gst/rules', { name: 'X', kind: 'SERVICE', code: '999721', rateBps: 700, itcType: 'WITH_ITC', from: '2026-01-01' })).status).toBe(400);
    expect((await call('business', 'POST', '/gst/rules', { name: 'X', kind: 'SERVICE', code: '12', rateBps: 500, itcType: 'WITH_ITC', from: '2026-01-01' })).status).toBe(400);
    expect((await call('business', 'POST', '/gst/rules', { name: 'X', kind: 'SERVICE', code: '999721', rateBps: 500, itcType: 'WITH_ITC', from: '2026-02-01', to: '2026-01-01' })).status).toBe(400);
  });

  it('a retried change with the same key happens once', async () => {
    const headers = { 'content-type': 'application/json', 'idempotency-key': 'same-key-12345', cookie: cookies.business };
    const body = JSON.stringify({ name: 'Nails', kind: 'SERVICE', code: '999729', rateBps: 500, itcType: 'WITHOUT_ITC', from: '2026-01-01' });
    await fetch(`${api}/gst/rules`, { method: 'POST', headers, body });
    await fetch(`${api}/gst/rules`, { method: 'POST', headers, body });
    expect(await GstTaxRule.countDocuments({ name: 'Nails' })).toBe(1);
  });
});
