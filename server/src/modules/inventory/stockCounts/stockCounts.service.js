import {
  InventoryAllocation,
  InventoryAllocationEvent,
  InventoryBalance,
  InventoryLocation,
  InventorySku,
  InventorySkuBranch,
  InventoryStockCount,
} from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { branchApproverIds, notify } from '../../notifications/notifications.service.js';
import { assertCan, can } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { postMovement } from '../stock/stock.engine.js';
import { takeFromHandout } from '../allocations/allocations.service.js';
import { ensureBranchLocations } from '../locations/locations.service.js';

// ---------------------------------------------------------------------------
// Stock count: start it (the records at that moment become "expected"), count the stores and each hand-out
// in use, submit, and an owner approves. Approved differences are posted as COUNT_CORRECTION movements,
// never by overwriting a balance (AC22). The count keeps who counted, who reviewed and why each line differs.
// ---------------------------------------------------------------------------

const SKU_FIELDS = 'name code stockUnit wayOfUse baseUnit unitsPerStockUnit';
const me = (ctx) => ({ id: ctx.userId, name: ctx.userName });
const countLink = '/app/inventory?tab=count';

async function allow(ctx, action) {
  assertCan(ctx, action, { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
}

const differs = (line) => line.counted != null && line.counted !== line.expected;

async function withSkus(ctx, count) {
  if (!count) return null;
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: count.lines.map((l) => l.skuId) } })).select(SKU_FIELDS).lean();
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));
  return { ...count, lines: count.lines.map((l) => ({ ...l, sku: skuOf[String(l.skuId)] })) };
}

// The count in progress at the selected branch (if any), and the last few finished ones
export async function getCounts(ctx) {
  await allow(ctx, 'inventory.countStock');
  const branchId = ctx.activeBranchId;
  const [current, past] = await Promise.all([
    InventoryStockCount.findOne(scoped(ctx, { branchId, status: { $in: ['COUNTING', 'SUBMITTED'] } })).lean(),
    InventoryStockCount.find(scoped(ctx, { branchId, status: { $in: ['APPROVED', 'CANCELLED'] } }))
      .select('-lines')
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
  ]);
  const settings = await getBranchSettings(ctx, branchId);
  return { current: await withSkus(ctx, current), past, canApprove: can(ctx, 'inventory.approveStockCount', { settings }).allowed };
}

async function findCount(ctx, id) {
  const count = await InventoryStockCount.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId }));
  if (!count) throw new AppError(404, 'NOT_FOUND', 'Stock count not found');
  return count;
}

// Start a count. Every product used here gets a line for its main store (and any other store holding it),
// and every open hand-out gets its own line, so store and in use are counted separately.
export async function startCount(ctx, key) {
  await allow(ctx, 'inventory.countStock');
  const branchId = ctx.activeBranchId;
  await ensureBranchLocations(ctx, branchId);

  return runOnce(ctx, { key, operation: 'inventory.count.start' }, async (session) => {
    const rows = await InventorySkuBranch.find(scoped(ctx, { branchId, active: true })).session(session).lean();
    const skus = await InventorySku.find(scoped(ctx, { _id: { $in: rows.map((r) => r.skuId) }, status: 'active' })).select('name').session(session).lean();
    const stores = await InventoryLocation.find(scoped(ctx, { branchId, kind: 'STORE' })).session(session).lean();
    const balances = await InventoryBalance.find(scoped(ctx, { branchId, locationId: { $in: stores.map((s) => s._id) } })).session(session).lean();
    const handouts = await InventoryAllocation.find(scoped(ctx, { branchId, status: 'OPEN' })).session(session).lean();
    const qtyAt = (skuId, locationId) => balances.find((b) => String(b.skuId) === String(skuId) && String(b.locationId) === String(locationId))?.qty ?? 0;
    const nameOf = Object.fromEntries(skus.map((s) => [String(s._id), s.name]));

    const lines = [];
    for (const sku of [...skus].sort((a, b) => a.name.localeCompare(b.name))) {
      for (const store of stores) {
        const expected = qtyAt(sku._id, store._id);
        if (store.isMain || expected > 0) {
          lines.push({ skuId: sku._id, skuName: sku.name, place: 'STORE', locationId: store._id, locationName: store.name, expected });
        }
      }
    }
    for (const h of handouts) {
      if (!nameOf[String(h.skuId)]) continue;
      lines.push({ skuId: h.skuId, skuName: nameOf[String(h.skuId)], place: 'HANDOUT', allocationId: h._id, heldBy: h.recipient.name, expected: h.remainingQty });
    }

    try {
      const [count] = await InventoryStockCount.create([{ orgId: ctx.orgId, branchId, cutoffAt: new Date(), lines, startedBy: me(ctx) }], { session });
      return { count: count.toObject() };
    } catch (err) {
      if (err.code === 11000) throw new AppError(409, 'COUNT_IN_PROGRESS', 'A stock count is already in progress at this branch');
      throw err;
    }
  });
}

// Save counted quantities (and reasons) as you go. lines: [{ lineId, counted (null = not counted), reason? }]
export async function saveCounts(ctx, id, { lines }) {
  await allow(ctx, 'inventory.countStock');
  const count = await findCount(ctx, id);
  if (count.status !== 'COUNTING') throw new AppError(409, 'INVALID_STATUS', 'This count has been sent for review. Ask an owner to send it back to change it.');
  for (const change of lines) {
    const line = count.lines.id(change.lineId);
    if (!line) throw new AppError(404, 'NOT_FOUND', 'Count line not found');
    line.counted = change.counted;
    if (change.reason !== undefined) line.reason = change.reason;
  }
  count.countedBy = me(ctx);
  await count.save();
  return { count: await withSkus(ctx, count.toObject()) };
}

// Done counting: every difference needs a reason, then an owner reviews it
export async function submitCount(ctx, id, key) {
  await allow(ctx, 'inventory.countStock');
  const count = await findCount(ctx, id);
  if (count.status !== 'COUNTING') throw new AppError(409, 'INVALID_STATUS', 'This count has already been sent for review');
  const missing = count.lines.filter((l) => differs(l) && !l.reason?.trim());
  if (missing.length > 0) {
    throw new AppError(400, 'REASON_REQUIRED', `Say why ${missing.length === 1 ? 'this line is' : `these ${missing.length} lines are`} different: ${missing.slice(0, 3).map((l) => l.skuName).join(', ')}`, { lineIds: missing.map((l) => l._id) });
  }

  return runOnce(ctx, { key, operation: 'inventory.count.submit' }, async (session) => {
    const marked = await InventoryStockCount.updateOne(
      scoped(ctx, { _id: count._id, status: 'COUNTING' }),
      { $set: { status: 'SUBMITTED', submittedAt: new Date(), countedBy: me(ctx) } },
      { session }
    );
    if (marked.modifiedCount === 0) throw new AppError(409, 'INVALID_STATUS', 'This count was just changed');
    const differences = count.lines.filter(differs).length;
    await notify(
      ctx,
      await branchApproverIds(ctx, count.branchId),
      { message: `${ctx.userName} finished a stock count (${differences === 0 ? 'no differences' : `${differences} difference${differences === 1 ? '' : 's'}`}). Please review it.`, link: countLink },
      session
    );
    return { status: 'SUBMITTED' };
  });
}

// An owner approves: each difference becomes a count-correction movement. Movements since the count started
// are real and stay; only the difference found is added (or taken away).
export async function approveCount(ctx, id, { note }, key) {
  await allow(ctx, 'inventory.approveStockCount');
  const count = await findCount(ctx, id);
  if (count.status !== 'SUBMITTED') throw new AppError(409, 'INVALID_STATUS', 'Only a count sent for review can be approved');
  const changed = count.lines.filter(differs);
  const { inUse } = await ensureBranchLocations(ctx, count.branchId);

  return runOnce(ctx, { key, operation: 'inventory.count.approve' }, async (session) => {
    const marked = await InventoryStockCount.updateOne(
      scoped(ctx, { _id: count._id, status: 'SUBMITTED' }),
      { $set: { status: 'APPROVED', reviewedBy: me(ctx), reviewedAt: new Date(), reviewNote: note } },
      { session }
    );
    if (marked.modifiedCount === 0) throw new AppError(409, 'INVALID_STATUS', 'This count was just changed');

    const transactionIds = [];
    if (changed.length > 0) {
      const movementLines = [];
      for (const line of changed) {
        const difference = line.counted - line.expected;
        if (line.place === 'HANDOUT') {
          // The hand-out itself changes too, so what people hold always matches In use
          if (difference < 0) {
            const handout = await InventoryAllocation.findOne(scoped(ctx, { _id: line.allocationId })).session(session).lean();
            await takeFromHandout(ctx, handout, -difference, session);
          } else {
            await InventoryAllocation.updateOne(scoped(ctx, { _id: line.allocationId }), { $inc: { remainingQty: difference, version: 1 }, $set: { status: 'OPEN', closedAt: null } }, { session });
          }
          movementLines.push({ skuId: line.skuId, locationId: inUse._id, qty: difference, bucket: 'ADJUSTED' });
        } else {
          movementLines.push({ skuId: line.skuId, locationId: line.locationId, qty: difference, bucket: 'ADJUSTED' });
        }
      }
      const { transaction } = await postMovement(
        ctx,
        { branchId: count.branchId, type: 'COUNT_CORRECTION', reason: 'STOCK_COUNT_CORRECTION', note: `Stock count${count.countedBy ? ` by ${count.countedBy.name}` : ''}`, reference: { kind: 'stock_count', id: count._id }, requestKey: key, lines: movementLines },
        session
      );
      transactionIds.push(transaction._id);
      const handoutLines = changed.filter((l) => l.place === 'HANDOUT');
      if (handoutLines.length > 0) {
        await InventoryAllocationEvent.create(
          handoutLines.map((l) => ({ orgId: ctx.orgId, branchId: count.branchId, allocationId: l.allocationId, type: 'CORRECTED', qty: l.counted - l.expected, transactionId: transaction._id, actorId: ctx.userId, actorName: ctx.userName, note: l.reason })),
          { session, ordered: true }
        );
      }
      await InventoryStockCount.updateOne(scoped(ctx, { _id: count._id }), { $set: { transactionIds } }, { session });
    }
    const words = changed.length === 0 ? 'no differences' : `${changed.length} difference${changed.length === 1 ? '' : 's'} corrected`;
    await recordInventoryAction(ctx, { action: 'inventory.count_approved', branchId: count.branchId, summary: `Approved the stock count (${words})`, after: { differences: changed.map((l) => ({ sku: l.skuName, expected: l.expected, counted: l.counted, reason: l.reason })) }, link: countLink }, session);
    if (count.countedBy) await notify(ctx, [count.countedBy.id], { message: `${ctx.userName} approved your stock count (${words})`, link: countLink }, session);
    return { status: 'APPROVED', transactionIds };
  });
}

// An owner sends it back to be counted again (with a note), or it is cancelled
export async function sendBackCount(ctx, id, { note }, key) {
  await allow(ctx, 'inventory.approveStockCount');
  const count = await findCount(ctx, id);
  return runOnce(ctx, { key, operation: 'inventory.count.sendBack' }, async (session) => {
    const marked = await InventoryStockCount.updateOne(scoped(ctx, { _id: count._id, status: 'SUBMITTED' }), { $set: { status: 'COUNTING', reviewNote: note } }, { session });
    if (marked.modifiedCount === 0) throw new AppError(409, 'INVALID_STATUS', 'Only a count sent for review can be sent back');
    if (count.countedBy) await notify(ctx, [count.countedBy.id], { message: `${ctx.userName} sent the stock count back: ${note}`, link: countLink }, session);
    return { status: 'COUNTING' };
  });
}

export async function cancelCount(ctx, id, key) {
  await allow(ctx, 'inventory.countStock');
  const count = await findCount(ctx, id);
  const isOwner = can(ctx, 'inventory.approveStockCount', { settings: await getBranchSettings(ctx, ctx.activeBranchId) }).allowed;
  if (!isOwner && String(count.startedBy?.id) !== ctx.userId) throw new AppError(403, 'PERMISSION_DENIED', 'Only an owner or the person who started it can cancel this count');
  return runOnce(ctx, { key, operation: 'inventory.count.cancel' }, async (session) => {
    const marked = await InventoryStockCount.updateOne(scoped(ctx, { _id: count._id, status: { $in: ['COUNTING', 'SUBMITTED'] } }), { $set: { status: 'CANCELLED' } }, { session });
    if (marked.modifiedCount === 0) throw new AppError(409, 'INVALID_STATUS', 'This count is already finished');
    return { status: 'CANCELLED' };
  });
}
