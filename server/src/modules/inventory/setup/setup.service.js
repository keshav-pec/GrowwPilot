import { InventoryLocation, InventorySettings, InventorySkuBranch } from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';

// The first-time setup guide, per branch:
// 1. where you keep stock  2. add your products  3. check before saving  4. done.
// Each step can be skipped and picked up later from the checklist on the Overview.

export async function getSetup(ctx) {
  const branchId = ctx.activeBranchId;
  const [settings, products, stations, withReorder] = await Promise.all([
    getBranchSettings(ctx, branchId),
    InventorySkuBranch.countDocuments(scoped(ctx, { branchId, active: true })),
    InventoryLocation.countDocuments(scoped(ctx, { branchId, kind: 'STATION', active: true })),
    InventorySkuBranch.countDocuments(scoped(ctx, { branchId, active: true, reorderPoint: { $ne: null } })),
  ]);
  return {
    completedAt: settings.setupCompletedAt,
    steps: {
      locations: Boolean(settings.setupSteps?.locationsAt),
      products: products > 0,
      reorderLevels: withReorder > 0,
    },
    counts: { products, stations, withReorder },
  };
}

const STEP_FIELD = { locations: 'setupSteps.locationsAt', done: 'setupCompletedAt' };

// Marks a step done ('locations') or the whole guide finished ('done').
// Owners and inventory logins (the people who set up stock) may do this.
export async function markSetupStep(ctx, step, key) {
  const branchId = ctx.activeBranchId;
  assertCan(ctx, 'inventory.editProducts', { settings: await getBranchSettings(ctx, branchId) });

  await runOnce(ctx, { key, operation: `inventory.setup.${step}` }, async (session) => {
    const before = await InventorySettings.findOne(scoped(ctx, { branchId })).session(session).lean();
    await InventorySettings.updateOne(scoped(ctx, { branchId }), { $set: { [STEP_FIELD[step]]: new Date() } }, { upsert: true, session });
    if (step === 'done' && !before?.setupCompletedAt) {
      await recordInventoryAction(ctx, { action: 'inventory.setup_finished', branchId, summary: 'Finished setting up inventory' }, session);
    }
  });
  return getSetup(ctx);
}
