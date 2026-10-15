import { InventoryBalance, InventoryLocation, InventorySku, InventorySkuBranch, User } from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';
import { branchApproverIds, notify } from '../../notifications/notifications.service.js';
import { describeQty } from '../units.js';

// The people who look after stock at a branch: its owners and its inventory logins
export async function stockKeeperIds(ctx, branchId) {
  const [owners, keepers] = await Promise.all([
    branchApproverIds(ctx, branchId),
    User.find(scoped(ctx, { role: 'INVENTORY', status: 'active', branchIds: branchId })).distinct('_id'),
  ]);
  return [...owners, ...keepers];
}

// Low stock = available to issue (what is in the stores, never what is in use) at or below the reorder point,
// or nothing left at all when no reorder point is set. The alert goes out once per product and branch,
// and is cleared when the product is restocked.
export async function refreshLowStock(ctx, branchId, skuIds, session) {
  const storeIds = await InventoryLocation.find(scoped(ctx, { branchId, kind: 'STORE' })).session(session).distinct('_id');
  for (const skuId of skuIds) {
    const here = await InventorySkuBranch.findOne(scoped(ctx, { branchId, skuId })).session(session);
    if (!here) continue;
    const balances = await InventoryBalance.find(scoped(ctx, { skuId, locationId: { $in: storeIds } })).select('qty').session(session).lean();
    const available = balances.reduce((sum, b) => sum + b.qty, 0);
    const low = here.reorderPoint != null ? available <= here.reorderPoint : available === 0;

    if (low && !here.lowStockAlertAt) {
      here.lowStockAlertAt = new Date();
      await here.save({ session });
      const sku = await InventorySku.findOne(scoped(ctx, { _id: skuId })).session(session).lean();
      const left = available === 0 ? 'none left in store' : `${describeQty(available, sku)} left in store`;
      const orderAt = here.reorderPoint != null ? ` (order at ${describeQty(here.reorderPoint, sku)})` : '';
      await notify(ctx, await stockKeeperIds(ctx, branchId), { message: `Low stock: ${sku.name}, ${left}${orderAt}`, link: `/app/inventory?tab=products&product=${skuId}` }, session);
    } else if (!low && here.lowStockAlertAt) {
      here.lowStockAlertAt = null;
      await here.save({ session });
    }
  }
}
