import { InventoryRecipe, InventorySku, Service } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { describeQty } from '../units.js';

// ---------------------------------------------------------------------------
// Service recipes (INV-09): which products a service uses, and how much.
// Salon-wide, or for one branch (the branch recipe wins). Every change is a new version from a start time;
// the previous version ends exactly there, so two versions are never in effect at once.
// ---------------------------------------------------------------------------

const SKU_FIELDS = 'name code stockUnit wayOfUse baseUnit unitsPerStockUnit status';
// Only these are used up automatically; finish-mode and by-hand products can only be linked (for reports)
const AUTOMATIC_WAYS = ['SERVICE_UNITS', 'SERVICE_MEASURED'];
const BACKDATE_GRACE_MS = 5 * 60 * 1000;

const inEffectAt = (at) => ({ effectiveFrom: { $lte: at }, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: at } }] });

// The recipe a service used at a moment, at a branch: the branch's own version, else the salon-wide one
export async function findRecipeInEffect(ctx, { serviceId, branchId, at }, session = null) {
  const branchRecipe = await InventoryRecipe.findOne(scoped(ctx, { serviceId, branchId, ...inEffectAt(at) })).session(session).lean();
  return branchRecipe ?? InventoryRecipe.findOne(scoped(ctx, { serviceId, branchId: null, ...inEffectAt(at) })).session(session).lean();
}

async function withSkus(ctx, recipes) {
  const ids = recipes.flatMap((r) => r?.lines.map((l) => l.skuId) ?? []);
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: ids } })).select(SKU_FIELDS).lean();
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));
  return recipes.map((r) => r && { ...r, lines: r.lines.map((l) => ({ ...l, sku: skuOf[String(l.skuId)] })) });
}

// Services offered at the selected branch, each with its salon-wide and branch recipe in effect now,
// any version starting later, and which one applies here
export async function listRecipes(ctx) {
  const branchId = ctx.activeBranchId;
  assertCan(ctx, 'inventory.viewRecipes', { settings: await getBranchSettings(ctx, branchId) });
  const now = new Date();
  const services = await Service.find(scoped(ctx, { status: 'active', $or: [{ branchIds: { $size: 0 } }, { branchIds: branchId }] }))
    .select('name category')
    .sort({ category: 1, name: 1 })
    .lean();
  const recipes = await InventoryRecipe.find(
    scoped(ctx, { serviceId: { $in: services.map((s) => s._id) }, branchId: { $in: [null, branchId] }, $or: [{ effectiveTo: null }, { effectiveTo: { $gt: now } }] })
  )
    .sort({ effectiveFrom: 1 })
    .lean();
  const enriched = await withSkus(ctx, recipes);

  return services.map((service) => {
    const mine = enriched.filter((r) => String(r.serviceId) === String(service._id));
    const pick = (scope) => {
      const ofScope = mine.filter((r) => (scope === 'branch' ? r.branchId : !r.branchId));
      return {
        current: ofScope.find((r) => r.effectiveFrom <= now) ?? null,
        upcoming: ofScope.filter((r) => r.effectiveFrom > now),
      };
    };
    const salon = pick('salon');
    const branch = pick('branch');
    return { service, salon, branch, applies: branch.current ? 'branch' : salon.current ? 'salon' : null };
  });
}

// Every version of one service's recipe (salon-wide or this branch's), newest first
export async function recipeHistory(ctx, { serviceId, scope }) {
  assertCan(ctx, 'inventory.viewRecipes', { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
  const branchId = scope === 'branch' ? ctx.activeBranchId : null;
  const versions = await InventoryRecipe.find(scoped(ctx, { serviceId, branchId })).sort({ version: -1 }).lean();
  return withSkus(ctx, versions);
}

// Business owner: salon-wide recipes and any branch's. Branch owner: only the recipes of their own branches.
async function assertCanEditScope(ctx, scope) {
  assertCan(ctx, 'inventory.editRecipes', { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
  if (scope === 'salon' && !ctx.isPrimaryOwner) {
    throw new AppError(403, 'PERMISSION_DENIED', 'Only the business owner changes salon-wide recipes. You can set one for this branch.');
  }
}

async function findService(ctx, serviceId, branchId) {
  const service = await Service.findOne(scoped(ctx, { _id: serviceId })).lean();
  if (!service) throw new AppError(404, 'NOT_FOUND', 'Service not found');
  if (branchId && service.branchIds.length > 0 && !service.branchIds.some((id) => String(id) === String(branchId))) {
    throw new AppError(400, 'VALIDATION_ERROR', `${service.name} isn’t offered at this branch`);
  }
  return service;
}

// "1 Facial kit, 60 ml Developer (linked)"
function describeLines(lines, skuOf) {
  if (lines.length === 0) return 'no products';
  return lines
    .map((l) => {
      const sku = skuOf[String(l.skuId)];
      return l.deducts ? `${describeQty(l.qty, sku)} ${sku.name}` : `${sku.name} (linked)`;
    })
    .join(', ');
}

// Save a new version. input: { serviceId, scope: 'salon' | 'branch', effectiveFrom?, lines, note? }
// lines: [{ skuId, qty, deducts, useStoreIfNeeded }]
export async function saveRecipe(ctx, input, key) {
  await assertCanEditScope(ctx, input.scope);
  const branchId = input.scope === 'branch' ? ctx.activeBranchId : null;
  const service = await findService(ctx, input.serviceId, branchId);
  const from = input.effectiveFrom ? new Date(input.effectiveFrom) : new Date();
  if (from < new Date(Date.now() - BACKDATE_GRACE_MS)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'A recipe can start now or later, not in the past (past services keep the recipe they used)');
  }

  const skuIds = input.lines.map((l) => l.skuId);
  if (new Set(skuIds).size !== skuIds.length) throw new AppError(400, 'VALIDATION_ERROR', 'Each product can be in the recipe only once');
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: skuIds } })).select(SKU_FIELDS).lean();
  if (skus.length !== skuIds.length) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));
  const lines = input.lines.map((l) => {
    const sku = skuOf[l.skuId];
    if (l.deducts && !AUTOMATIC_WAYS.includes(sku.wayOfUse)) {
      throw new AppError(400, 'RECIPE_LINK_ONLY', `${sku.name} is used up when someone marks it finished (or by hand), so it can only be linked to this service, not taken per service`);
    }
    if (l.deducts && !l.qty) throw new AppError(400, 'VALIDATION_ERROR', `How much ${sku.name} does one ${service.name} use?`);
    return { skuId: sku._id, qty: l.deducts ? l.qty : null, deducts: l.deducts, useStoreIfNeeded: l.useStoreIfNeeded ?? true };
  });

  try {
    return await runOnce(ctx, { key, operation: 'inventory.recipe.save' }, async (session) => {
      const where = scoped(ctx, { serviceId: service._id, branchId });
      // A version starting at or after this one would overlap with it
      if (await InventoryRecipe.exists({ ...where, effectiveFrom: { $gte: from } }).session(session)) {
        throw new AppError(409, 'RECIPE_CONFLICT', 'A version of this recipe already starts at or after that time. Change that one instead, or pick a later start.');
      }
      const latest = await InventoryRecipe.findOne(where).sort({ version: -1 }).session(session).lean();
      // The version in effect at the start time ends there
      await InventoryRecipe.updateOne({ ...where, ...inEffectAt(from) }, { $set: { effectiveTo: from } }, { session });
      const [recipe] = await InventoryRecipe.create(
        [{ ...where, version: (latest?.version ?? 0) + 1, effectiveFrom: from, lines, note: input.note, createdBy: { id: ctx.userId, name: ctx.userName } }],
        { session }
      );
      const scopeWords = branchId ? ' (this branch only)' : ' (all branches)';
      await recordInventoryAction(
        ctx,
        {
          action: 'inventory.recipe_changed',
          branchId: branchId ?? ctx.activeBranchId,
          summary: `Set the recipe for ${service.name}${scopeWords}, version ${recipe.version}: ${describeLines(lines, skuOf)}`,
          after: { version: recipe.version, lines },
          link: '/app/inventory?tab=recipes',
        },
        session
      );
      return { recipe };
    });
  } catch (err) {
    if (err.code === 11000) throw new AppError(409, 'RECIPE_CONFLICT', 'Someone else just changed this recipe. Open it again to see the latest.');
    throw err;
  }
}

// Stop using a recipe from now on (a branch recipe ending means the salon-wide one applies there again)
export async function endRecipe(ctx, { serviceId, scope }, key) {
  await assertCanEditScope(ctx, scope);
  const branchId = scope === 'branch' ? ctx.activeBranchId : null;
  const service = await findService(ctx, serviceId, null);
  const now = new Date();
  const where = scoped(ctx, { serviceId: service._id, branchId });
  if (await InventoryRecipe.exists({ ...where, effectiveFrom: { $gt: now } })) {
    throw new AppError(409, 'RECIPE_CONFLICT', 'A newer version is scheduled to start later. Change that one instead.');
  }
  const current = await InventoryRecipe.findOne({ ...where, ...inEffectAt(now) }).lean();
  if (!current) throw new AppError(404, 'NOT_FOUND', 'There is no recipe in use to stop');

  return runOnce(ctx, { key, operation: 'inventory.recipe.end' }, async (session) => {
    await InventoryRecipe.updateOne({ _id: current._id, effectiveTo: null }, { $set: { effectiveTo: now } }, { session });
    await recordInventoryAction(
      ctx,
      { action: 'inventory.recipe_changed', branchId: branchId ?? ctx.activeBranchId, summary: `Stopped the ${branchId ? 'branch' : 'salon-wide'} recipe for ${service.name}`, link: '/app/inventory?tab=recipes' },
      session
    );
    return { ended: true };
  });
}
