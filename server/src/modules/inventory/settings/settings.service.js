import { InventorySettings } from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';

// The inventory rules for one branch. A branch nobody has changed yet gets the defaults
// (from the model), without saving anything.
export async function getBranchSettings(ctx, branchId) {
  const saved = await InventorySettings.findOne(scoped(ctx, { branchId })).lean();
  return saved ?? new InventorySettings({ orgId: ctx.orgId, branchId }).toObject();
}
