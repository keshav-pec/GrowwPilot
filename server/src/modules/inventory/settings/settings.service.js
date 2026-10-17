import { InventoryLocation, InventorySettings, InventorySku } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { formatAmount } from '../../../utils/money.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan } from '../permissions.js';
import { recordInventoryAction } from '../activity.js';
import { reconcile } from '../stock/stock.engine.js';

// The inventory rules for one branch. A branch nobody has changed yet gets the defaults
// (from the model), without saving anything.
export async function getBranchSettings(ctx, branchId) {
  const saved = await InventorySettings.findOne(scoped(ctx, { branchId })).lean();
  return saved ?? new InventorySettings({ orgId: ctx.orgId, branchId }).toObject();
}

// ---------------------------------------------------------------------------
// Settings screen (INV-15) for the selected branch: what the front desk may do, approval limits and
// whether branch owners see costs. Owners only. A branch owner may change the front desk switches and the
// inventory login's limit, but not their own limits or cost visibility (the business owner decides those).
// ---------------------------------------------------------------------------
const OWNER_ONLY = ['limits.branchOwnerWriteOff', 'limits.branchOwnerPoApproval', 'branchOwnerSeesCosts'];

export async function getSettingsForScreen(ctx) {
  const settings = await getBranchSettings(ctx, ctx.activeBranchId);
  assertCan(ctx, 'inventory.manageSettings', { settings });
  const { frontDesk, limits, branchOwnerSeesCosts, updatedAt } = settings;
  return { frontDesk, limits, branchOwnerSeesCosts, updatedAt, canChangeOwnerRules: ctx.isPrimaryOwner };
}

// changes: { frontDesk?: { finish, issue, transfer, receive }, limits?: { ... }, branchOwnerSeesCosts? }
export async function updateSettings(ctx, changes, key) {
  const branchId = ctx.activeBranchId;
  const before = await getBranchSettings(ctx, branchId);
  assertCan(ctx, 'inventory.manageSettings', { settings: before });

  // Flatten to dotted paths, so only what was sent changes
  const set = {};
  for (const [group, value] of Object.entries(changes)) {
    if (value && typeof value === 'object') for (const [field, v] of Object.entries(value)) set[`${group}.${field}`] = v;
    else set[group] = value;
  }
  if (!ctx.isPrimaryOwner && Object.keys(set).some((path) => OWNER_ONLY.includes(path))) {
    throw new AppError(403, 'PERMISSION_DENIED', 'Only the business owner changes branch owners’ limits and whether they see costs');
  }
  const words = Object.entries(set).map(([path, v]) => `${SETTING_WORDS[path] ?? path}: ${typeof v === 'boolean' ? (v ? 'on' : 'off') : path.startsWith('limits.') ? formatAmount(v) : v}`);

  return runOnce(ctx, { key, operation: 'inventory.settings.update' }, async (session) => {
    await InventorySettings.updateOne(scoped(ctx, { branchId }), { $set: set }, { upsert: true, session, runValidators: true });
    await recordInventoryAction(ctx, { action: 'inventory.settings_changed', branchId, summary: `Changed inventory settings: ${words.join(', ')}`, after: set, link: '/app/inventory?tab=settings' }, session);
    const saved = await InventorySettings.findOne(scoped(ctx, { branchId })).session(session).lean();
    return { frontDesk: saved.frontDesk, limits: saved.limits, branchOwnerSeesCosts: saved.branchOwnerSeesCosts };
  });
}

const SETTING_WORDS = {
  'frontDesk.finish': 'front desk marks finished',
  'frontDesk.issue': 'front desk issues and returns',
  'frontDesk.transfer': 'front desk moves hand-outs',
  'frontDesk.receive': 'front desk receives deliveries',
  'limits.inventoryWriteOff': 'inventory login write-off limit',
  'limits.branchOwnerWriteOff': 'branch owner write-off limit',
  'limits.branchOwnerPoApproval': 'branch owner order approval limit',
  branchOwnerSeesCosts: 'branch owners see costs',
};

// Rebuilds every balance from the movement history and lists any that don't match (owners only).
// Should always come back empty; anything else means something wrote stock outside the stock engine.
export async function checkStockRecords(ctx) {
  const settings = await getBranchSettings(ctx, ctx.activeBranchId);
  assertCan(ctx, 'inventory.manageSettings', { settings });
  const branchIds = ctx.isPrimaryOwner ? [null] : ctx.allowedBranchIds;
  const mismatches = [];
  for (const branchId of branchIds) mismatches.push(...(await reconcile(ctx, branchId ? { branchId } : {})));
  const [skus, locations] = await Promise.all([
    InventorySku.find(scoped(ctx, { _id: { $in: mismatches.map((m) => m.skuId) } })).select('name').lean(),
    InventoryLocation.find(scoped(ctx, { _id: { $in: mismatches.map((m) => m.locationId) } })).select('name').lean(),
  ]);
  const name = (list, id) => list.find((x) => String(x._id) === String(id))?.name;
  return {
    checkedAt: new Date(),
    ok: mismatches.length === 0,
    mismatches: mismatches.map((m) => ({ ...m, skuName: name(skus, m.skuId), locationName: name(locations, m.locationId) })),
  };
}
