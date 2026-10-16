import {
  InventoryAllocation,
  InventoryAllocationEvent,
  InventoryBalance,
  InventoryConsumptionEvent,
  InventoryLocation,
  InventorySku,
  InventorySkuBranch,
} from '../../../models/index.js';
import { isMeasured } from '../../../config/inventory.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { postMovement } from '../stock/stock.engine.js';
import { takeFromHandout } from '../allocations/allocations.service.js';
import { describeQty } from '../units.js';

// ---------------------------------------------------------------------------
// The stock one recipe line uses for one completed service ("service instance"), posted in one transaction.
//   use: { key, branchId, appointmentId, serviceLineId, serviceId, serviceName, staffId, staffName,
//          recipeId, recipeVersion, recipeLineId, skuId, qty, useStoreIfNeeded, completedAt }
// Whole units come from the stores (main store first). Measured products (ml / g) come from open hand-outs
// first, the stylist's own bottle before others, then from the stores if the recipe allows.
// Never below zero: if there isn't enough, nothing is taken and an error says why.
// ---------------------------------------------------------------------------

// Why an automatic use couldn't be posted, for the exceptions list
export const EXCEPTION_REASON = {
  INSUFFICIENT_AVAILABLE_STOCK: 'NOT_ENOUGH_STOCK',
  NOT_STOCKED_HERE: 'NOT_STOCKED_HERE',
  PRODUCT_INACTIVE: 'PRODUCT_INACTIVE',
  NO_OPEN_HANDOUT: 'NO_OPEN_HANDOUT',
};

// The parts of a use that are copied onto exceptions and corrections
export const USE_FIELDS = [
  'branchId',
  'appointmentId',
  'serviceLineId',
  'serviceId',
  'serviceName',
  'staffId',
  'staffName',
  'recipeId',
  'recipeVersion',
  'recipeLineId',
  'skuId',
  'qty',
  'useStoreIfNeeded',
  'completedAt',
];
export const pickUse = (row) => Object.fromEntries(USE_FIELDS.map((f) => [f, row[f]]));

const heldByOf = (use) => (use.staffId ? { kind: 'STAFF', id: use.staffId, name: use.staffName } : undefined);

// options: { actor (who reported it), note, correctsConsumptionId, correctsTransactionId }
export async function postServiceUse(ctx, use, options, session) {
  const { branchId, skuId } = use;
  // One after the other: the first read starts the transaction, and two at once can't both start it
  const sku = await InventorySku.findOne(scoped(ctx, { _id: skuId })).session(session).lean();
  const here = await InventorySkuBranch.exists(scoped(ctx, { branchId, skuId, active: true })).session(session);
  if (!sku || !here) throw new AppError(409, 'NOT_STOCKED_HERE', `${sku?.name ?? 'This product'} isn’t stocked at this branch`);
  if (sku.status !== 'active') throw new AppError(409, 'PRODUCT_INACTIVE', `${sku.name} is deactivated`);

  const lines = [];
  const sources = [];
  let need = use.qty;

  if (isMeasured(sku)) {
    const inUse = await InventoryLocation.findOne(scoped(ctx, { branchId, kind: 'IN_USE' })).session(session).lean();
    const isMine = (h) => h.recipient.kind === 'STAFF' && String(h.recipient.id) === String(use.staffId);
    const handouts = await InventoryAllocation.find(scoped(ctx, { branchId, skuId, status: 'OPEN' })).sort({ createdAt: 1 }).session(session).lean();
    handouts.sort((a, b) => isMine(b) - isMine(a)); // the stylist's own open bottle first, then the oldest
    for (const handout of handouts) {
      if (need === 0) break;
      const take = Math.min(need, handout.remainingQty);
      if (take === 0) continue;
      await takeFromHandout(ctx, handout, take, session);
      sources.push({ allocationId: handout._id, qty: take });
      need -= take;
    }
    const fromInUse = use.qty - need;
    if (fromInUse > 0) lines.push({ skuId, locationId: inUse._id, qty: -fromInUse, bucket: 'CONSUMED' });
    if (need > 0 && !use.useStoreIfNeeded) {
      throw new AppError(409, 'NO_OPEN_HANDOUT', `No open ${sku.stockUnit} of ${sku.name} has ${describeQty(need, sku)} left, and this recipe doesn’t take from the store`);
    }
  }

  if (need > 0) {
    const stores = await InventoryLocation.find(scoped(ctx, { branchId, kind: 'STORE' })).session(session).lean();
    stores.sort((a, b) => b.isMain - a.isMain || a.name.localeCompare(b.name));
    const balances = await InventoryBalance.find(scoped(ctx, { skuId, locationId: { $in: stores.map((s) => s._id) } })).session(session).lean();
    const qtyAt = Object.fromEntries(balances.map((b) => [String(b.locationId), b.qty]));
    const available = balances.reduce((sum, b) => sum + b.qty, 0);
    if (available < need) {
      throw new AppError(409, 'INSUFFICIENT_AVAILABLE_STOCK', `Not enough ${sku.name}: this needs ${describeQty(use.qty, sku)}, only ${describeQty(use.qty - need + available, sku)} available`);
    }
    for (const store of stores) {
      const take = Math.min(need, qtyAt[String(store._id)] ?? 0);
      if (take === 0) continue;
      lines.push({ skuId, locationId: store._id, qty: -take, bucket: 'CONSUMED' });
      sources.push({ qty: take });
      need -= take;
      if (need === 0) break;
    }
  }

  const { transaction } = await postMovement(
    ctx,
    {
      branchId,
      type: 'SERVICE_USE',
      note: options.note,
      actor: options.actor,
      heldBy: heldByOf(use),
      reference: { kind: 'appointment', id: use.appointmentId },
      correctsId: options.correctsTransactionId,
      occurredAt: use.completedAt,
      requestKey: use.key,
      lines,
    },
    session
  );
  const [consumption] = await InventoryConsumptionEvent.create(
    [
      {
        ...pickUse(use),
        orgId: ctx.orgId,
        key: use.key,
        wayOfUse: sku.wayOfUse,
        sources,
        transactionId: transaction._id,
        correctsId: options.correctsConsumptionId ?? null,
        note: options.note,
      },
    ],
    { session }
  );
  const fromHandouts = sources.filter((s) => s.allocationId);
  if (fromHandouts.length > 0) {
    await InventoryAllocationEvent.create(
      fromHandouts.map((s) => ({
        orgId: ctx.orgId,
        branchId,
        allocationId: s.allocationId,
        type: 'SERVICE_USE',
        qty: s.qty,
        transactionId: transaction._id,
        actorId: options.actor?.id ?? ctx.userId,
        actorName: options.actor?.name ?? ctx.userName,
        note: use.serviceName,
      })),
      { session, ordered: true }
    );
  }
  return { transaction, consumption: consumption.toObject() };
}

// A measured service used less than recorded: the difference goes back where it came from
// (the open hand-out it was taken from, or the main store when that is closed)
export async function giveBackServiceUse(ctx, original, qty, { key, actor, note, correctsTransactionId }, session) {
  const { branchId, skuId } = original;
  const handoutSource = original.sources.find((s) => s.allocationId);
  const handout = handoutSource
    ? await InventoryAllocation.findOne(scoped(ctx, { _id: handoutSource.allocationId, status: 'OPEN' })).session(session).lean()
    : null;

  let locationId;
  if (handout) {
    await InventoryAllocation.updateOne(scoped(ctx, { _id: handout._id }), { $inc: { remainingQty: qty, version: 1 } }, { session });
    locationId = (await InventoryLocation.findOne(scoped(ctx, { branchId, kind: 'IN_USE' })).session(session).lean())._id;
  } else {
    locationId = (await InventoryLocation.findOne(scoped(ctx, { branchId, isMain: true })).session(session).lean())._id;
  }

  const { transaction } = await postMovement(
    ctx,
    {
      branchId,
      type: 'CORRECTION',
      note,
      actor,
      heldBy: heldByOf(original),
      reference: { kind: 'appointment', id: original.appointmentId },
      correctsId: correctsTransactionId,
      requestKey: key,
      lines: [{ skuId, locationId, qty, bucket: 'CONSUMED' }],
    },
    session
  );
  await InventoryConsumptionEvent.create(
    [
      {
        ...pickUse(original),
        orgId: ctx.orgId,
        key,
        qty: -qty,
        wayOfUse: original.wayOfUse,
        sources: [{ allocationId: handout?._id, qty: -qty }],
        transactionId: transaction._id,
        correctsId: original._id,
        note,
      },
    ],
    { session }
  );
  return { transaction };
}
