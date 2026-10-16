import {
  InventoryAllocation,
  InventoryApproval,
  InventoryException,
  InventoryLedgerEntry,
  InventoryOutbox,
  InventorySku,
  InventorySkuBranch,
  InventoryTransaction,
} from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';
import { can } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { availableToIssue, branchStock } from '../stock/stock.queries.js';

const UNIT_FIELDS = 'name code stockUnit wayOfUse baseUnit unitsPerStockUnit';

// Overview (INV-01) for the selected branch: stock health, what needs ordering, hand-outs that need a
// handover, requests waiting, and recent activity. Stock value only for people who may see costs.
// The front desk's recent activity is limited to their own actions.
export async function getOverview(ctx) {
  const branchId = ctx.activeBranchId;
  const settings = await getBranchSettings(ctx, branchId);
  const canSeeCosts = can(ctx, 'inventory.viewCosts', { settings }).allowed;
  const handlesRequests = can(ctx, 'inventory.writeOff', { settings, value: 0 }).allowed;
  const handlesExceptions = can(ctx, 'inventory.resolveExceptions', { settings }).allowed;

  const rows = await InventorySkuBranch.find(scoped(ctx, { branchId, active: true })).lean();
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: rows.map((r) => r.skuId) }, status: 'active' })).select(UNIT_FIELDS).lean();
  const stock = await branchStock(ctx, branchId, skus.map((s) => s._id));
  const rowOf = Object.fromEntries(rows.map((r) => [String(r.skuId), r]));

  let value = 0;
  const needToOrder = [];
  let inStoreProducts = 0;
  for (const sku of skus) {
    const { inStore, inUse } = stock[String(sku._id)];
    const here = rowOf[String(sku._id)];
    const available = availableToIssue({ inStore });
    if (inStore > 0) inStoreProducts += 1;
    if (here.avgCost != null) value += (inStore + inUse) * here.avgCost;
    if (here.reorderPoint != null && available <= here.reorderPoint) {
      needToOrder.push({ sku, available, inUse, reorderPoint: here.reorderPoint, reorderQty: here.reorderQty });
    }
  }
  needToOrder.sort((a, b) => a.available - b.available);

  const [openHandouts, handover, waiting, exceptions, failedEvents, recent] = await Promise.all([
    InventoryAllocation.countDocuments(scoped(ctx, { branchId, status: 'OPEN' })),
    InventoryAllocation.find(scoped(ctx, { branchId, status: 'OPEN', needsHandover: true })).sort({ createdAt: 1 }).lean(),
    handlesRequests ? InventoryApproval.countDocuments(scoped(ctx, { branchId, status: 'PENDING' })) : 0,
    handlesExceptions ? InventoryException.countDocuments(scoped(ctx, { branchId, status: 'OPEN' })) : 0,
    handlesExceptions ? InventoryOutbox.countDocuments(scoped(ctx, { branchId, status: 'FAILED' })) : 0,
    recentActivity(ctx, branchId, { mineOnly: ctx.role === 'FRONT_DESK' }),
  ]);
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));

  return {
    totals: {
      products: skus.length,
      inStoreProducts,
      openHandouts,
      needToOrder: needToOrder.length,
      ...(canSeeCosts && { stockValue: Math.round(value) }),
    },
    needToOrder: needToOrder.slice(0, 10),
    handover: handover.map((h) => ({ ...h, sku: skuOf[String(h.skuId)] })),
    waitingRequests: waiting,
    automationIssues: exceptions + failedEvents, // services that couldn't take their stock
    recent,
  };
}

// The latest stock movements at a branch, each with its lines in words-ready form
async function recentActivity(ctx, branchId, { mineOnly }) {
  const filter = scoped(ctx, { branchId });
  if (mineOnly) filter.actorId = ctx.userId;
  const transactions = await InventoryTransaction.find(filter).sort({ postedAt: -1 }).limit(12).lean();
  const entries = await InventoryLedgerEntry.find(scoped(ctx, { transactionId: { $in: transactions.map((t) => t._id) } }))
    .populate('locationId', 'name kind')
    .lean();
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: entries.map((e) => e.skuId) } })).select(UNIT_FIELDS).lean();
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));

  return transactions.map((t) => ({
    _id: t._id,
    type: t.type,
    reason: t.reason,
    note: t.note,
    actorName: t.actorName,
    heldBy: t.heldBy?.kind ? t.heldBy : null,
    occurredAt: t.occurredAt,
    lines: entries
      .filter((e) => String(e.transactionId) === String(t._id))
      .map((e) => ({ qty: e.qty, location: e.locationId, sku: skuOf[String(e.skuId)] })),
  }));
}
