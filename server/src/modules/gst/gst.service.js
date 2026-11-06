import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { BillingSettings, Branch, GstRegistration, GstTaxRule, InventorySku, Invoice, Organization, Service } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { GST_STATES, isValidGstin } from '../../config/billing.js';
import { STARTER_RULE, SUPPORTED_GST_SCHEMES } from '../../config/gst.js';
import { logActivity } from '../activity/activity.service.js';
import { getBillingSettings } from '../billing/settings.service.js';
import { computeBill } from '../billing/tax.rules.js';
import { billContext, gstSetupActive, ruleTax } from './gst.billing.js';
import { addOlderDocuments } from './gst.ledger.js';
import { clashingRules, dayBefore, niceDate, periodsOverlap, registrationFor, ruleFor, setupChecks } from './gst.rules.js';

// ---------------------------------------------------------------------------
// GST setup: the business owner chooses Not registered or Regular, adds dated GST registrations and links branches,
// approves dated tax rules, tries test bills, and activates. Branch owners can look. Nobody else gets in.
// Until a salon activates, its bills work exactly as before.
// ---------------------------------------------------------------------------

const SALE_PRODUCTS = { type: 'RETAIL', status: 'active', sellPrice: { $ne: null }, wayOfUse: { $ne: 'SERVICE_MEASURED' } };
const INDIA = 'Asia/Kolkata';

function assertBusinessOwner(ctx) {
  if (!ctx.isPrimaryOwner) throw new AppError(403, 'FORBIDDEN', 'Only the business owner can change GST setup');
}

const branchesOf = (ctx, session = null) => Branch.find(scoped(ctx)).select('name status timezone createdAt').sort({ createdAt: 1, _id: 1 }).session(session).lean();
const hasInventory = (ctx) => Boolean(ctx.addons?.includes('inventory'));

// What has to have a rule before activating
async function chargeableItems(ctx, session = null) {
  const services = await Service.find(scoped(ctx, { status: 'active' })).select('name taxRuleGroupId').session(session).lean();
  const products = hasInventory(ctx) ? await InventorySku.find(scoped(ctx, SALE_PRODUCTS)).select('name taxRuleGroupId').session(session).lean() : [];
  return { services, products };
}

async function checksFor(ctx, settings, session = null) {
  const [branches, registrations, rules, items] = [await branchesOf(ctx, session), await GstRegistration.find(scoped(ctx)).session(session).lean(), await GstTaxRule.find(scoped(ctx, { status: 'APPROVED' })).session(session).lean(), await chargeableItems(ctx, session)];
  const today = todayInZone(branches[0]?.timezone ?? INDIA);
  return setupChecks({ settings, today, branches, registrations, rules, ...items });
}

// What the Overview lists as needing attention
export async function setupStateFor(ctx, settings) {
  return { problems: (await checksFor(ctx, settings)).filter((c) => !c.ok && c.key !== 'testBill') };
}

// ---- moving existing branch GSTINs -----------------------------------------

// A salon's GSTINs from Billing settings become dated registrations (once only: a branch already linked is skipped).
export async function moveBranchGstins(orgId, session = null) {
  const settings = await BillingSettings.findOne({ orgId }).session(session).lean();
  const rows = (settings?.branches ?? []).filter((b) => b.gstin);
  if (rows.length === 0) return 0;
  const existing = await GstRegistration.find({ orgId }).session(session).lean();
  const linked = new Set(existing.flatMap((r) => r.branches.map((link) => String(link.branchId))));
  const waiting = rows.filter((b) => !linked.has(String(b.branchId)));
  if (waiting.length === 0) return 0;

  const org = await Organization.findById(orgId).select('name createdAt').session(session).lean();
  const from = DateTime.fromJSDate(org.createdAt ?? new Date(), { zone: INDIA }).toISODate();
  const byGstin = new Map();
  for (const row of waiting) byGstin.set(row.gstin, [...(byGstin.get(row.gstin) ?? []), row]);
  for (const [gstin, list] of byGstin) {
    const links = list.map((b) => ({ branchId: b.branchId, from, to: null }));
    const same = existing.find((r) => r.gstin === gstin && !r.to);
    if (same) {
      await GstRegistration.updateOne({ _id: same._id }, { $push: { branches: { $each: links } } }, { session });
    } else {
      await GstRegistration.create([{ orgId, gstin, legalName: settings.legalName || org.name, stateCode: list[0].stateCode ?? gstin.slice(0, 2), from, branches: links }], { session });
    }
  }
  return waiting.length;
}

// Billing settings keep showing each branch's GSTIN of today (bills of a salon that hasn't activated also read it from there)
async function copyTodaysGstins(ctx, session) {
  const settings = await getBillingSettings(ctx, session);
  const [branches, registrations] = [await branchesOf(ctx, session), await GstRegistration.find(scoped(ctx)).session(session).lean()];
  const rows = branches.flatMap((branch) => {
    const saved = settings.branches?.find((b) => String(b.branchId) === String(branch._id));
    const reg = registrationFor(registrations, branch._id, todayInZone(branch.timezone));
    if (!saved && !reg) return [];
    return [{ branchId: branch._id, gstin: reg?.gstin ?? null, stateCode: reg?.stateCode ?? null, invoicePrefix: saved?.invoicePrefix ?? null }];
  });
  await BillingSettings.updateOne(scoped(ctx), { $set: { branches: rows } }, { upsert: true, session, runValidators: true });
}

// ---- the screen ------------------------------------------------------------

const presentRegistration = (branches) => (r) => ({
  _id: r._id,
  gstin: r.gstin,
  legalName: r.legalName,
  stateCode: r.stateCode,
  stateName: GST_STATES[r.stateCode] ?? r.stateCode,
  filingFrequency: r.filingFrequency,
  from: r.from,
  to: r.to,
  branches: r.branches.map((link) => ({ ...link, name: branches.find((b) => String(b._id) === String(link.branchId))?.name })),
});

// Rules by group, newest first, with the row that applies today
function rulesByGroup(rules, today) {
  const groups = new Map();
  for (const rule of [...rules].sort((a, b) => b.from.localeCompare(a.from))) {
    const key = String(rule.groupId);
    if (!groups.has(key)) groups.set(key, { groupId: rule.groupId, name: rule.name, kind: rule.kind, rows: [] });
    groups.get(key).rows.push(rule);
  }
  return [...groups.values()].map((g) => ({ ...g, current: ruleFor(g.rows, g.groupId, today) }));
}

export async function getSetup(ctx) {
  const settings = await getBillingSettings(ctx);
  const [branches, registrations, rules, items] = await Promise.all([branchesOf(ctx), GstRegistration.find(scoped(ctx)).sort({ from: -1, createdAt: -1 }).lean(), GstTaxRule.find(scoped(ctx)).lean(), chargeableItems(ctx)]);
  const today = todayInZone(branches[0]?.timezone ?? INDIA);
  const mine = (r) => ctx.isPrimaryOwner || r.branches.some((link) => ctx.allowedBranchIds.includes(String(link.branchId)));
  const gst = settings.gst ?? {};
  const noGroup = (list) => list.filter((item) => !item.taxRuleGroupId).length;
  return {
    scheme: gst.scheme ?? (settings.gstRegistered ? 'REGULAR' : 'UNREGISTERED'),
    active: gstSetupActive(settings),
    startMonth: gst.startMonth ?? '',
    pricesIncludeTax: settings.pricesIncludeTax,
    activatedAt: gst.activatedAt ?? null,
    activatedByName: gst.activatedByName ?? null,
    today,
    branches: branches.filter((b) => ctx.isPrimaryOwner || ctx.allowedBranchIds.includes(String(b._id))).map((b) => ({ _id: b._id, name: b.name, status: b.status })),
    registrations: registrations.filter(mine).map(presentRegistration(branches)),
    groups: rulesByGroup(rules, today),
    unlinked: { SERVICE: noGroup(items.services), PRODUCT: noGroup(items.products) },
    checks: await checksFor(ctx, settings),
    canEdit: Boolean(ctx.isPrimaryOwner),
    canViewTax: Boolean(ctx.isPrimaryOwner || settings.branchOwners?.viewGst),
  };
}

// For the service and product forms: which rules can be chosen, and whether the rule decides the tax yet
export async function ruleOptions(ctx) {
  const settings = await getBillingSettings(ctx);
  const rules = await GstTaxRule.find(scoped(ctx)).lean();
  const branch = await Branch.findOne(scoped(ctx)).select('timezone').lean();
  const today = todayInZone(branch?.timezone ?? INDIA);
  return { active: gstSetupActive(settings), groups: rulesByGroup(rules, today).map(({ groupId, name, kind, current }) => ({ groupId, name, kind, current })) };
}

// ---- registration type, start month, prices --------------------------------

// input: { scheme, startMonth?, pricesIncludeTax?, reason? (needed to stop using an active setup) }
export async function saveSetup(ctx, { scheme, startMonth, pricesIncludeTax, reason }, key) {
  assertBusinessOwner(ctx);
  if (!SUPPORTED_GST_SCHEMES.includes(scheme)) throw new AppError(400, 'REGIME_NOT_SUPPORTED', 'Composition and QRMP are not supported. Choose Not registered or Regular.');
  const before = await getBillingSettings(ctx);
  const active = gstSetupActive(before);
  if (scheme === 'UNREGISTERED' && active && !reason?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Say why this salon is no longer GST registered');
  if (active && startMonth !== undefined && startMonth !== before.gst?.startMonth) throw new AppError(409, 'START_MONTH_LOCKED', 'The start month can’t change once GST setup is active');

  return runOnce(ctx, { key, operation: 'gst.setup.save' }, async (session) => {
    const set = { 'gst.scheme': scheme };
    if (pricesIncludeTax !== undefined) set.pricesIncludeTax = pricesIncludeTax;
    if (scheme === 'REGULAR') {
      if (startMonth) set['gst.startMonth'] = startMonth;
      await moveBranchGstins(ctx.orgId, session);
      if (!(await GstTaxRule.exists(scoped(ctx)).session(session))) {
        const code = before.defaultSacCode || STARTER_RULE.code;
        await GstTaxRule.create([{ ...STARTER_RULE, code, orgId: ctx.orgId, groupId: new mongoose.Types.ObjectId(), createdBy: ctx.userId }], { session });
      }
    } else {
      set.gstRegistered = false;
      set['gst.status'] = 'NOT_ACTIVE';
    }
    await BillingSettings.updateOne(scoped(ctx), { $set: set }, { upsert: true, session, runValidators: true });
    const stopped = scheme === 'UNREGISTERED' && active;
    const summary = stopped ? `Stopped using GST setup: ${reason.trim()}` : `GST setup: registration type ${scheme === 'REGULAR' ? 'Regular' : 'Not registered'}${set['gst.startMonth'] ? `, start month ${set['gst.startMonth']}` : ''}`;
    await logActivity(ctx, { action: stopped ? 'billing.gst_stopped' : 'billing.gst_setup_changed', summary, before: before.gst, after: set }, session);
    return { saved: true };
  });
}

// ---- registrations and branch links ----------------------------------------

function assertValidRegistration({ gstin, stateCode, legalName }) {
  if (!isValidGstin(gstin)) throw new AppError(400, 'REGISTRATION_INVALID', `The GSTIN ${gstin} doesn’t look right. Please check it.`, { field: 'gstin' });
  if (gstin.slice(0, 2) !== stateCode) throw new AppError(400, 'REGISTRATION_INVALID', `The GSTIN ${gstin} belongs to ${GST_STATES[gstin.slice(0, 2)]}, not ${GST_STATES[stateCode] ?? stateCode}`, { field: 'stateCode' });
  if (!legalName?.trim()) throw new AppError(400, 'REGISTRATION_INVALID', 'Enter the legal name on this registration', { field: 'legalName' });
}

// Makes room for a branch from a date. A period that overlaps is refused, unless move is on and that period has no end
// date: then it ends the day before (never when bills under the old GSTIN are already dated on or after that day).
async function makeRoomForBranch(ctx, { branch, from, move }, session) {
  const registrations = await GstRegistration.find(scoped(ctx, { 'branches.branchId': branch._id })).session(session);
  for (const reg of registrations) {
    let changed = false;
    for (const link of reg.branches) {
      if (String(link.branchId) !== String(branch._id) || !periodsOverlap(link, { from, to: null })) continue;
      if (link.to || !move) {
        throw new AppError(409, 'BRANCH_MAPPING_CONFLICT', `${branch.name} already uses GSTIN ${reg.gstin} from ${niceDate(link.from)}${link.to ? ` to ${niceDate(link.to)}` : ''}. A branch can only have one GSTIN on any date.`, { field: 'branches' });
      }
      const billed = await Invoice.exists(scoped(ctx, { branchId: branch._id, 'seller.gstin': reg.gstin, status: { $in: ['ISSUED', 'VOID'] }, taxDate: { $gte: from } })).session(session);
      if (billed) throw new AppError(409, 'BILLS_UNDER_OLD_GSTIN', `${branch.name} already has bills under ${reg.gstin} on or after ${niceDate(from)}. Choose a later date.`, { field: 'from' });
      link.to = dayBefore(from);
      changed = true;
    }
    if (changed) {
      if (reg.branches.every((link) => link.to)) reg.to = reg.branches.map((link) => link.to).sort().at(-1);
      await reg.save({ session });
    }
  }
}

// input: { gstin, legalName, stateCode, from, branchIds, move }
export async function addRegistration(ctx, input, key) {
  assertBusinessOwner(ctx);
  const { gstin, legalName, stateCode, from, branchIds, move = false } = input;
  assertValidRegistration({ gstin, stateCode, legalName });
  const branches = await branchesOf(ctx);
  const chosen = branchIds.map((id) => branches.find((b) => String(b._id) === id));
  if (chosen.some((b) => !b)) throw new AppError(404, 'NOT_FOUND', 'Branch not found');

  return runOnce(ctx, { key, operation: 'gst.registration.add' }, async (session) => {
    if (!move && (await GstRegistration.exists(scoped(ctx, { gstin, to: null })).session(session))) {
      throw new AppError(409, 'BRANCH_MAPPING_CONFLICT', `${gstin} is already added. Link the branch to it instead.`, { field: 'gstin' });
    }
    if (await GstRegistration.exists(scoped(ctx, { gstin, from })).session(session)) {
      throw new AppError(409, 'BRANCH_MAPPING_CONFLICT', `${gstin} already has a row starting on ${niceDate(from)}. Choose another date.`, { field: 'from' });
    }
    await moveBranchGstins(ctx.orgId, session);
    for (const branch of chosen) await makeRoomForBranch(ctx, { branch, from, move }, session);
    const [created] = await GstRegistration.create(
      [{ orgId: ctx.orgId, gstin, legalName: legalName.trim(), stateCode, from, branches: chosen.map((b) => ({ branchId: b._id, from, to: null })), createdBy: ctx.userId }],
      { session }
    );
    await copyTodaysGstins(ctx, session);
    await logActivity(ctx, { action: 'billing.gst_registration_added', summary: `Added GST registration ${gstin} from ${from} for ${chosen.map((b) => b.name).join(', ')}`, after: { gstin, legalName, stateCode, from, branchIds, move } }, session);
    return { registrationId: created._id };
  });
}

// input: { branchId, from, move }
export async function linkBranch(ctx, registrationId, { branchId, from, move = false }, key) {
  assertBusinessOwner(ctx);
  const branch = (await branchesOf(ctx)).find((b) => String(b._id) === branchId);
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');

  return runOnce(ctx, { key, operation: 'gst.registration.link' }, async (session) => {
    await moveBranchGstins(ctx.orgId, session);
    await makeRoomForBranch(ctx, { branch, from, move }, session);
    const reg = await GstRegistration.findOne(scoped(ctx, { _id: registrationId })).session(session);
    if (!reg) throw new AppError(404, 'NOT_FOUND', 'Registration not found');
    if (reg.to) throw new AppError(409, 'BRANCH_MAPPING_CONFLICT', `${reg.gstin} is no longer in use`, { field: 'gstin' });
    if (from < reg.from) throw new AppError(400, 'VALIDATION_ERROR', `${reg.gstin} starts on ${niceDate(reg.from)}. Choose that date or a later one.`, { field: 'from' });
    reg.branches.push({ branchId: branch._id, from, to: null });
    await reg.save({ session });
    await copyTodaysGstins(ctx, session);
    await logActivity(ctx, { action: 'billing.gst_branch_linked', branchId: branch._id, summary: `Linked ${branch.name} to GSTIN ${reg.gstin} from ${from}`, after: { registrationId, branchId, from, move } }, session);
    return { linked: true };
  });
}

// ---- tax rules -------------------------------------------------------------

async function assertNoClash(ctx, rule, session) {
  const peers = await GstTaxRule.find(scoped(ctx, { groupId: rule.groupId })).session(session).lean();
  const clash = clashingRules(peers, rule)[0];
  if (clash) throw new AppError(409, 'RULE_OVERLAP', `These dates overlap ${clash.name} (${clash.rateBps / 100}%, from ${niceDate(clash.from)}${clash.to ? ` to ${niceDate(clash.to)}` : ''}). Choose other dates.`, { field: 'from' });
}

// A new rule, or (with groupId) a new dated row of an existing one. It starts as a draft.
// input: { groupId?, name, kind, code, rateBps, itcType, from, to? }
export async function createRule(ctx, input, key) {
  assertBusinessOwner(ctx);
  return runOnce(ctx, { key, operation: 'gst.rule.create' }, async (session) => {
    let { name, kind } = input;
    if (input.groupId) {
      const peer = await GstTaxRule.findOne(scoped(ctx, { groupId: input.groupId })).session(session).lean();
      if (!peer) throw new AppError(404, 'NOT_FOUND', 'Tax rule not found');
      ({ name, kind } = peer);
    }
    if (!name || !kind) throw new AppError(400, 'VALIDATION_ERROR', 'Give the rule a name and say if it is for services or products');
    const rule = { ...input, name, kind, orgId: ctx.orgId, groupId: input.groupId ?? new mongoose.Types.ObjectId(), to: input.to ?? null, status: 'DRAFT', createdBy: ctx.userId };
    await assertNoClash(ctx, rule, session);
    const [created] = await GstTaxRule.create([rule], { session });
    await logActivity(ctx, { action: 'billing.gst_rule_added', summary: `Added a draft tax rule: ${name}, ${created.code}, ${created.rateBps / 100}% from ${created.from}`, after: created.toObject() }, session);
    return { ruleId: created._id };
  });
}

function assertDraftRule(rule) {
  if (!rule) throw new AppError(404, 'NOT_FOUND', 'Tax rule not found');
  if (rule.status !== 'DRAFT') throw new AppError(409, 'RULE_LOCKED', 'An approved rule can’t be changed. Add a new dated rule instead.');
}

// Drafts can still change. input: { name?, code?, rateBps?, itcType?, from?, to? }
export async function updateRule(ctx, id, input, key) {
  assertBusinessOwner(ctx);
  return runOnce(ctx, { key, operation: 'gst.rule.update' }, async (session) => {
    const rule = await GstTaxRule.findOne(scoped(ctx, { _id: id })).session(session).lean();
    assertDraftRule(rule);
    await assertNoClash(ctx, { ...rule, ...input }, session);
    const saved = await GstTaxRule.updateOne(scoped(ctx, { _id: id, status: 'DRAFT' }), { $set: input }, { session, runValidators: true });
    if (saved.matchedCount !== 1) assertDraftRule({ status: 'APPROVED' });
    await logActivity(ctx, { action: 'billing.gst_rule_changed', summary: `Changed the draft tax rule ${rule.name}`, before: rule, after: input }, session);
    return { saved: true };
  });
}

export async function deleteRule(ctx, id, key) {
  assertBusinessOwner(ctx);
  return runOnce(ctx, { key, operation: 'gst.rule.delete' }, async (session) => {
    const rule = await GstTaxRule.findOne(scoped(ctx, { _id: id })).session(session).lean();
    assertDraftRule(rule);
    await GstTaxRule.deleteOne(scoped(ctx, { _id: id, status: 'DRAFT' })).session(session);
    await logActivity(ctx, { action: 'billing.gst_rule_deleted', summary: `Deleted the draft tax rule ${rule.name}`, before: rule }, session);
    return { deleted: true };
  });
}

// The business owner approves a draft and says who reviewed it. An older rule with no end date ends the day before.
export async function approveRule(ctx, id, { reviewedBy }, key) {
  assertBusinessOwner(ctx);
  return runOnce(ctx, { key, operation: 'gst.rule.approve' }, async (session) => {
    const rule = await GstTaxRule.findOne(scoped(ctx, { _id: id })).session(session).lean();
    assertDraftRule(rule);
    await assertNoClash(ctx, rule, session);
    const earlier = await GstTaxRule.find(scoped(ctx, { groupId: rule.groupId, status: 'APPROVED', to: null, from: { $lt: rule.from } })).session(session).lean();
    for (const old of earlier) {
      if (await Invoice.exists(scoped(ctx, { 'lines.taxRuleId': old._id, status: { $in: ['ISSUED', 'VOID'] }, taxDate: { $gte: rule.from } })).session(session)) {
        throw new AppError(409, 'RULE_ALREADY_USED', `Bills already used ${old.rateBps / 100}% on or after ${niceDate(rule.from)}. Old bills never change, so choose a later start date.`, { field: 'from' });
      }
      await GstTaxRule.updateOne({ _id: old._id, status: 'APPROVED', to: null }, { $set: { to: dayBefore(rule.from) } }, { session });
    }
    await GstTaxRule.updateOne(
      scoped(ctx, { _id: id, status: 'DRAFT' }),
      { $set: { status: 'APPROVED', reviewedBy: reviewedBy.trim(), approvedBy: ctx.userId, approvedByName: ctx.userName, approvedAt: new Date() } },
      { session }
    );
    await logActivity(ctx, { action: 'billing.gst_rule_approved', summary: `Approved the tax rule ${rule.name}: ${rule.code}, ${rule.rateBps / 100}% from ${rule.from} (reviewed by ${reviewedBy.trim()})`, after: { ruleId: id, reviewedBy: reviewedBy.trim() } }, session);
    return { approved: true };
  });
}

// One click for the usual case: every service (or product for sale) with no rule yet gets this one
export async function linkUnlinked(ctx, groupId, key) {
  assertBusinessOwner(ctx);
  return runOnce(ctx, { key, operation: 'gst.rule.link' }, async (session) => {
    const rule = await GstTaxRule.findOne(scoped(ctx, { groupId })).session(session).lean();
    if (!rule) throw new AppError(404, 'NOT_FOUND', 'Tax rule not found');
    const result = rule.kind === 'SERVICE'
      ? await Service.updateMany(scoped(ctx, { status: 'active', taxRuleGroupId: null }), { $set: { taxRuleGroupId: groupId } }, { session })
      : await InventorySku.updateMany(scoped(ctx, { ...SALE_PRODUCTS, taxRuleGroupId: null }), { $set: { taxRuleGroupId: groupId }, $inc: { version: 1 } }, { session });
    await logActivity(ctx, { action: 'billing.gst_rule_linked', summary: `Linked ${result.modifiedCount} ${rule.kind === 'SERVICE' ? 'services' : 'products'} to the tax rule ${rule.name}`, after: { groupId, count: result.modifiedCount } }, session);
    return { linked: result.modifiedCount };
  });
}

// ---- test bills and activation ---------------------------------------------

// A sample bill worked out exactly like a real one. Nothing is saved except that a working test bill was tried.
// input: { branchId, placeOfSupply?, date?, billDiscount?, lines: [{ groupId, name?, unitPrice, qty }] }
export async function testBill(ctx, { branchId, placeOfSupply, date, billDiscount, lines }) {
  assertBusinessOwner(ctx);
  const branch = (await branchesOf(ctx)).find((b) => String(b._id) === branchId);
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  const settings = await getBillingSettings(ctx);
  const gst = await billContext(ctx, { branchId, place: placeOfSupply, date });

  const allRules = await GstTaxRule.find(scoped(ctx)).lean();
  const blockers = [...gst.blockers];
  const priced = lines.map((line) => {
    const taxes = ruleTax(gst, line.groupId, 'code');
    const name = line.name || allRules.find((r) => String(r.groupId) === line.groupId)?.name || 'Line';
    if (!taxes.taxRuleId) blockers.push({ code: 'TAX_CLASSIFICATION_MISSING', message: `${name} has no approved tax rule for ${niceDate(gst.taxDate)}.` });
    return { ...line, ...taxes, name };
  });
  const bill = computeBill(
    priced.map((l) => ({ name: l.name, unitPrice: l.unitPrice, qty: l.qty, taxRateBps: l.taxRateBps })),
    billDiscount ?? null,
    { gstRegistered: true, pricesIncludeTax: settings.pricesIncludeTax, useTaxRules: true, interstate: gst.interstate }
  );
  if (blockers.length === 0) await BillingSettings.updateOne(scoped(ctx), { $set: { 'gst.testBillAt': new Date() } }, { upsert: true });
  return {
    date: gst.taxDate,
    gstin: gst.registration?.gstin ?? null,
    placeOfSupply: gst.placeOfSupply,
    interstate: gst.interstate,
    pricesIncludeTax: settings.pricesIncludeTax,
    lines: priced.map((l, i) => ({ name: l.name, code: l.code, rateBps: l.taxRateBps, itcType: l.itcType, ...bill.lines[i] })),
    totals: bill.totals,
    taxSummary: bill.taxSummary,
    blockers,
  };
}

// Every check must pass. Bills issued from now on use the approved rules. The configuration is kept in the activity log.
// Older GST bills from the start month on are then added to the tax record (the nightly check finishes the job if the server stops).
export async function activate(ctx, key) {
  assertBusinessOwner(ctx);
  const result = await runOnce(ctx, { key, operation: 'gst.activate' }, async (session) => {
    const settings = await getBillingSettings(ctx, session);
    if (gstSetupActive(settings)) return { activated: true };
    const checks = await checksFor(ctx, settings, session);
    const failed = checks.filter((c) => !c.ok);
    if (failed.length > 0) throw new AppError(409, failed.some((c) => c.code === 'REGISTRATION_INVALID') ? 'REGISTRATION_INVALID' : 'GST_CONFIGURATION_INCOMPLETE', failed[0].message, { checks: failed });

    const now = new Date();
    const registrations = await GstRegistration.find(scoped(ctx)).session(session).lean();
    const rules = await GstTaxRule.find(scoped(ctx, { status: 'APPROVED' })).session(session).lean();
    const first = registrations.find((r) => !r.to);
    await BillingSettings.updateOne(
      scoped(ctx),
      { $set: { gstRegistered: true, legalName: settings.legalName || first.legalName, 'gst.status': 'ACTIVE', 'gst.activatedAt': now, 'gst.activatedBy': ctx.userId, 'gst.activatedByName': ctx.userName, 'gst.recordFrom': now } },
      { session }
    );
    await copyTodaysGstins(ctx, session);
    await logActivity(ctx, { action: 'billing.gst_activated', summary: `Activated GST setup, with returns from ${settings.gst.startMonth}`, after: { startMonth: settings.gst.startMonth, pricesIncludeTax: settings.pricesIncludeTax, registrations, rules } }, session);
    return { activated: true };
  });
  await addOlderDocuments(ctx.orgId, await getBillingSettings(ctx));
  return result;
}

