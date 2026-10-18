import { BillingSettings, Branch, Invoice, Organization } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { escapeRegex } from '../../utils/regex.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { GST_STATES, isValidGstin } from '../../config/billing.js';

// "Andheri" -> "AND"
export function branchCode(name) {
  return name.replace(/[^a-z]/gi, '').slice(0, 3).toUpperCase() || 'BR';
}

// The salon's billing rules. A salon nobody has set up yet gets the defaults (from the model), without saving anything.
export async function getBillingSettings(ctx, session = null) {
  const saved = await BillingSettings.findOne(scoped(ctx)).session(session).lean();
  return saved ?? new BillingSettings({ orgId: ctx.orgId }).toObject();
}

// Every branch's bill prefix. A saved prefix wins; the others come from the branch name and are made unique
// ("Andheri" and "Andheri East" -> "AND" and "AN2"), so two branches never print the same numbers.
export function resolvePrefixes(branches, saved) {
  const savedOf = Object.fromEntries((saved ?? []).filter((b) => b.invoicePrefix).map((b) => [String(b.branchId), b.invoicePrefix]));
  const taken = new Set(Object.values(savedOf));
  const result = {};
  for (const b of branches) {
    const id = String(b._id);
    if (savedOf[id]) {
      result[id] = savedOf[id];
      continue;
    }
    const code = branchCode(b.name);
    let prefix = code;
    for (let n = 2; taken.has(prefix); n++) prefix = `${code.slice(0, 2)}${n}`;
    taken.add(prefix);
    result[id] = prefix;
  }
  return result;
}

// One branch's GST details and bill prefix, as bills need them
export async function branchBilling(ctx, branchId, settings, session = null) {
  const branches = await Branch.find(scoped(ctx)).select('name createdAt').sort({ createdAt: 1, _id: 1 }).session(session).lean();
  const prefixes = resolvePrefixes(branches, settings.branches);
  const saved = settings.branches?.find((b) => String(b.branchId) === String(branchId));
  const stateCode = saved?.stateCode ?? null;
  return { gstin: saved?.gstin ?? null, stateCode, stateName: stateCode ? GST_STATES[stateCode] : null, invoicePrefix: prefixes[String(branchId)] };
}

// ---------------------------------------------------------------------------
// Billing settings screen. Owners see it; only the business owner changes it
// (branch owners may be allowed to in Phase 2).
// ---------------------------------------------------------------------------
export async function getSettingsForScreen(ctx) {
  const [settings, branches, org] = await Promise.all([
    getBillingSettings(ctx),
    Branch.find(scoped(ctx)).select('name status createdAt').sort({ createdAt: 1, _id: 1 }).lean(),
    Organization.findById(ctx.orgId).select('name').lean(),
  ]);
  const prefixes = resolvePrefixes(branches, settings.branches);
  const visible = ctx.isPrimaryOwner ? branches : branches.filter((b) => ctx.allowedBranchIds.includes(String(b._id)));
  return {
    salonName: org?.name,
    legalName: settings.legalName,
    gstRegistered: settings.gstRegistered,
    pricesIncludeTax: settings.pricesIncludeTax,
    defaultServiceTaxBps: settings.defaultServiceTaxBps,
    defaultSacCode: settings.defaultSacCode,
    frontDeskDiscountLimitBps: settings.frontDeskDiscountLimitBps,
    guestProductSales: settings.guestProductSales,
    branches: visible.map((b) => {
      const saved = settings.branches?.find((x) => String(x.branchId) === String(b._id));
      return { branchId: b._id, name: b.name, status: b.status, gstin: saved?.gstin ?? '', stateCode: saved?.stateCode ?? '', invoicePrefix: prefixes[String(b._id)], prefixIsSaved: Boolean(saved?.invoicePrefix) };
    }),
    canEdit: ctx.isPrimaryOwner,
    updatedAt: settings.updatedAt ?? null,
  };
}

const WORDS = {
  legalName: 'legal name',
  gstRegistered: 'GST registered',
  pricesIncludeTax: 'prices include GST',
  defaultServiceTaxBps: 'default service GST',
  defaultSacCode: 'default SAC code',
  frontDeskDiscountLimitBps: 'front desk discount limit',
  guestProductSales: 'guest product sales',
};
function describe(field, value) {
  if (typeof value === 'boolean') return `${WORDS[field]}: ${value ? 'on' : 'off'}`;
  if (field.endsWith('Bps')) return `${WORDS[field]}: ${value / 100}%`;
  return `${WORDS[field]}: ${value || '(empty)'}`;
}

// input: any of the salon fields, plus branches: [{ branchId, gstin, stateCode, invoicePrefix }]
export async function updateSettings(ctx, input, key) {
  if (!ctx.isPrimaryOwner) throw new AppError(403, 'FORBIDDEN', 'Only the business owner can change billing settings');
  const before = await getBillingSettings(ctx);
  const branches = await Branch.find(scoped(ctx)).select('name createdAt').sort({ createdAt: 1, _id: 1 }).lean();

  // Branch rows: start from what's saved, apply what was sent
  const rows = new Map((before.branches ?? []).map((b) => [String(b.branchId), { branchId: b.branchId, gstin: b.gstin ?? null, stateCode: b.stateCode ?? null, invoicePrefix: b.invoicePrefix ?? null }]));
  const branchWords = [];
  for (const change of input.branches ?? []) {
    const branch = branches.find((b) => String(b._id) === change.branchId);
    if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
    const gstin = change.gstin || null;
    let stateCode = change.stateCode || null;
    if (gstin) {
      if (!isValidGstin(gstin)) throw new AppError(400, 'INVALID_GSTIN', `The GSTIN for ${branch.name} doesn't look right. Please check it.`);
      if (stateCode && stateCode !== gstin.slice(0, 2)) throw new AppError(400, 'INVALID_GSTIN', `The GSTIN for ${branch.name} belongs to ${GST_STATES[gstin.slice(0, 2)]}, not ${GST_STATES[stateCode]}`);
      stateCode = gstin.slice(0, 2);
    }
    const row = { branchId: branch._id, gstin, stateCode, invoicePrefix: change.invoicePrefix || null };
    const old = rows.get(String(branch._id));
    if (old?.gstin !== row.gstin || old?.stateCode !== row.stateCode || old?.invoicePrefix !== row.invoicePrefix) {
      branchWords.push(`${branch.name}: GSTIN ${row.gstin ?? '(none)'}, prefix ${row.invoicePrefix ?? 'automatic'}`);
    }
    rows.set(String(branch._id), row);
  }

  // Prefixes must be different for every branch, and not already printed on another branch's bills
  const chosen = [...rows.values()].filter((r) => r.invoicePrefix);
  const seen = new Map();
  for (const r of chosen) {
    const name = branches.find((b) => String(b._id) === String(r.branchId))?.name;
    if (seen.has(r.invoicePrefix)) throw new AppError(400, 'DUPLICATE_PREFIX', `${seen.get(r.invoicePrefix)} and ${name} can't both use the prefix ${r.invoicePrefix}`);
    seen.set(r.invoicePrefix, name);
    const usedElsewhere = await Invoice.exists(scoped(ctx, { branchId: { $ne: r.branchId }, invoiceNumber: new RegExp(`^${escapeRegex(r.invoicePrefix)}/`) }));
    if (usedElsewhere) throw new AppError(400, 'DUPLICATE_PREFIX', `The prefix ${r.invoicePrefix} is already on another branch's bills. Please choose another.`);
  }

  const set = {};
  for (const field of Object.keys(WORDS)) if (input[field] !== undefined) set[field] = input[field];
  if ((set.gstRegistered ?? before.gstRegistered) && !(set.legalName ?? before.legalName)) {
    throw new AppError(400, 'LEGAL_NAME_REQUIRED', 'Enter the legal name printed on GST bills');
  }
  set.branches = [...rows.values()];

  const words = [
    ...Object.entries(set)
      .filter(([field, value]) => field !== 'branches' && value !== before[field])
      .map(([field, value]) => describe(field, value)),
    ...branchWords,
  ];

  return runOnce(ctx, { key, operation: 'billing.settings.update' }, async (session) => {
    await BillingSettings.updateOne(scoped(ctx), { $set: set }, { upsert: true, session, runValidators: true });
    if (words.length > 0) {
      await logActivity(ctx, { action: 'billing.settings_changed', summary: `Changed billing settings: ${words.join('; ')}`, before: { ...before, branches: undefined }, after: set }, session);
    }
    return { saved: true };
  });
}
