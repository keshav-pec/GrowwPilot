import mongoose from 'mongoose';
import { InventoryBalance, InventoryLedgerEntry, InventoryLocation, InventorySkuBranch, InventoryTransaction } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { actorRole } from '../../activity/activity.service.js';
import { refreshLowStock } from './lowStock.js';

// ---------------------------------------------------------------------------
// The stock engine: the ONLY code that writes stock movements and balances.
//
// A movement is one action (opening stock, issue, finish...) made of signed lines:
//   issue 1 bottle = [-1 Main store, +1 In use]
// For every line the balance changes by exactly that amount, in the same transaction as the history rows,
// so the balances can always be rebuilt from the history (see reconcile below).
//
// Stock never goes below zero: a line that takes stock away only matches a balance that has enough left.
// Two people acting at the same moment can't both take the last bottle.
// ---------------------------------------------------------------------------

// Lines that bring in stock at a known price change the moving average cost
const COSTED_BUCKETS = ['OPENING', 'RECEIVED'];

const unique = (values) => [...new Set(values.map(String))];

// postMovement(ctx, {
//   branchId, type, reason?, note?, heldBy?, reference?, correctsId?, requestKey?, occurredAt?,
//   actor? ({ id, name, role }: who reported it, when that isn't the person saving it), approvedBy? ({ id, name }),
//   lines: [{ skuId, locationId, qty: +10 | -1, bucket, unitCost? (paise per counting unit) }],
// }, session)
// -> { transaction, entries }
export async function postMovement(ctx, movement, session) {
  if (!session) throw new Error('postMovement must run inside a transaction');
  const { branchId, type, reason, note, heldBy, reference, correctsId, requestKey, approvedBy, lines } = movement;
  const actor = movement.actor ?? { id: ctx.userId, name: ctx.userName, role: actorRole(ctx) };

  if (!lines?.length) throw new AppError(400, 'VALIDATION_ERROR', 'A stock movement needs at least one line');
  for (const line of lines) {
    if (!Number.isInteger(line.qty) || line.qty === 0) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Quantities must be whole numbers');
    }
  }

  // Every place must belong to this branch (and salon), and hold stock (stations don't, their stock is In use)
  const locationIds = unique(lines.map((l) => l.locationId));
  const locations = await InventoryLocation.find(scoped(ctx, { _id: { $in: locationIds }, branchId })).session(session).lean();
  if (locations.length !== locationIds.length) throw new AppError(404, 'NOT_FOUND', 'Stock location not found');
  if (locations.some((l) => l.kind === 'STATION')) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Stations hold no stock of their own. Use In use instead.');
  }

  // Every product must be used at this branch
  const skuIds = unique(lines.map((l) => l.skuId));
  const skuBranches = await InventorySkuBranch.find(scoped(ctx, { branchId, skuId: { $in: skuIds } })).session(session);
  if (skuBranches.length !== skuIds.length) throw new AppError(404, 'NOT_FOUND', 'Product not found at this branch');
  const skuBranchOf = Object.fromEntries(skuBranches.map((sb) => [String(sb.skuId), sb]));

  // Cost: each line saves the cost of that moment. Stock arriving at a known price updates the average first.
  const costedLines = lines.map((line) => ({ ...line }));
  for (const skuId of skuIds) {
    const sb = skuBranchOf[skuId];
    const incoming = costedLines.filter((l) => String(l.skuId) === skuId && l.qty > 0 && l.unitCost != null && COSTED_BUCKETS.includes(l.bucket));
    if (incoming.length > 0) {
      const onHand = await branchOnHand(ctx, branchId, skuId, session);
      const qtyIn = incoming.reduce((sum, l) => sum + l.qty, 0);
      const valueIn = incoming.reduce((sum, l) => sum + l.qty * l.unitCost, 0);
      // Stock already here without a known cost doesn't drag the average down: nothing is guessed
      sb.avgCost = sb.avgCost == null || onHand === 0 ? valueIn / qtyIn : (onHand * sb.avgCost + valueIn) / (onHand + qtyIn);
      await sb.save({ session });
    }
    for (const line of costedLines) {
      if (String(line.skuId) === skuId && line.unitCost == null) line.unitCost = sb.avgCost ?? null;
    }
  }

  // Balances
  for (const line of costedLines) {
    const where = { orgId: ctx.orgId, locationId: line.locationId, skuId: line.skuId };
    if (line.qty < 0) {
      const taken = await InventoryBalance.updateOne({ ...where, qty: { $gte: -line.qty } }, { $inc: { qty: line.qty, version: 1 } }, { session });
      if (taken.matchedCount === 0) {
        const balance = await InventoryBalance.findOne(where).session(session).lean();
        const location = locations.find((l) => String(l._id) === String(line.locationId));
        const available = balance?.qty ?? 0;
        throw new AppError(409, 'INSUFFICIENT_AVAILABLE_STOCK', `Only ${available} left in ${location.name}`, {
          skuId: String(line.skuId),
          locationId: String(line.locationId),
          requested: -line.qty,
          available,
        });
      }
    } else {
      await InventoryBalance.updateOne(where, { $inc: { qty: line.qty, version: 1 }, $setOnInsert: { branchId } }, { upsert: true, session });
    }
  }

  // History: one header and its lines, never changed afterwards
  const postedAt = new Date();
  const occurredAt = movement.occurredAt ?? postedAt;
  const [transaction] = await InventoryTransaction.create(
    [
      {
        orgId: ctx.orgId,
        branchId,
        type,
        reason,
        note,
        actorId: actor.id,
        actorName: actor.name,
        actorRole: actor.role,
        heldBy,
        reference,
        correctsId,
        approvedBy,
        requestKey,
        occurredAt,
        postedAt,
      },
    ],
    { session }
  );
  const entries = await InventoryLedgerEntry.create(
    costedLines.map((line) => ({
      orgId: ctx.orgId,
      branchId,
      transactionId: transaction._id,
      skuId: line.skuId,
      locationId: line.locationId,
      qty: line.qty,
      unitCost: line.unitCost,
      bucket: line.bucket,
      occurredAt,
      postedAt,
    })),
    { session, ordered: true }
  );

  // Stock in the stores changed: raise (or clear) low-stock alerts
  const storeChanged = unique(costedLines.filter((l) => locations.find((loc) => String(loc._id) === String(l.locationId)).kind === 'STORE').map((l) => l.skuId));
  await refreshLowStock(ctx, branchId, storeChanged, session);

  return { transaction, entries };
}

// Opening stock for many products just added at this branch (spreadsheet import): one OPENING movement
// per product, written in a few bulk steps so up to 2,000 products fit in one transaction.
// items: [{ skuId, qty, unitCost? (paise per counting unit) }]. The products must have no stock here yet.
export async function postOpeningStock(ctx, { branchId, locationId, requestKey, items }, session) {
  if (!session) throw new Error('postOpeningStock must run inside a transaction');
  if (items.length === 0) return;
  if (items.some((i) => !Number.isInteger(i.qty) || i.qty <= 0)) throw new AppError(400, 'VALIDATION_ERROR', 'Quantities must be whole numbers');

  const skuIds = items.map((i) => i.skuId);
  const [store, usedHere, hasStock] = await Promise.all([
    InventoryLocation.findOne(scoped(ctx, { _id: locationId, branchId, kind: 'STORE' })).session(session).lean(),
    InventorySkuBranch.countDocuments(scoped(ctx, { branchId, skuId: { $in: skuIds } })).session(session),
    InventoryBalance.exists(scoped(ctx, { branchId, skuId: { $in: skuIds } })).session(session),
  ]);
  if (!store) throw new AppError(404, 'NOT_FOUND', 'Stock location not found');
  if (usedHere !== new Set(skuIds.map(String)).size) throw new AppError(404, 'NOT_FOUND', 'Product not found at this branch');
  if (hasStock) throw new Error('postOpeningStock is only for products without stock');

  // No stock yet, so the average cost is simply the opening cost (nothing is guessed when there is none)
  const costed = items.filter((i) => i.unitCost != null);
  if (costed.length > 0) {
    await InventorySkuBranch.bulkWrite(
      costed.map((i) => ({ updateOne: { filter: { orgId: ctx.orgId, branchId, skuId: i.skuId }, update: { $set: { avgCost: i.unitCost } } } })),
      { session }
    );
  }
  await InventoryBalance.bulkWrite(
    items.map((i) => ({
      updateOne: { filter: { orgId: ctx.orgId, locationId, skuId: i.skuId }, update: { $inc: { qty: i.qty, version: 1 }, $setOnInsert: { branchId } }, upsert: true },
    })),
    { session }
  );

  const postedAt = new Date();
  const header = { orgId: ctx.orgId, branchId, type: 'OPENING', actorId: ctx.userId, actorName: ctx.userName, actorRole: actorRole(ctx), requestKey, occurredAt: postedAt, postedAt };
  const transactions = await InventoryTransaction.insertMany(items.map(() => header), { session });
  await InventoryLedgerEntry.insertMany(
    items.map((i, n) => ({
      orgId: ctx.orgId,
      branchId,
      transactionId: transactions[n]._id,
      skuId: i.skuId,
      locationId,
      qty: i.qty,
      unitCost: i.unitCost ?? null,
      bucket: 'OPENING',
      occurredAt: postedAt,
      postedAt,
    })),
    { session }
  );
}

// Store + in use for one product at a branch
async function branchOnHand(ctx, branchId, skuId, session) {
  const balances = await InventoryBalance.find(scoped(ctx, { branchId, skuId })).select('qty').session(session).lean();
  return balances.reduce((sum, b) => sum + b.qty, 0);
}

// Rebuilds every balance from the movement history and lists any that don't match (should always be empty).
// Phase 7 turns this into an owner-only check; tests use it after mixed actions (PRD AC24).
export async function reconcile(ctx, { branchId } = {}) {
  const match = { orgId: new mongoose.Types.ObjectId(ctx.orgId) };
  if (branchId) match.branchId = new mongoose.Types.ObjectId(String(branchId));

  const [fromHistory, balances] = await Promise.all([
    InventoryLedgerEntry.aggregate([{ $match: match }, { $group: { _id: { locationId: '$locationId', skuId: '$skuId' }, qty: { $sum: '$qty' } } }]),
    InventoryBalance.find(match).select('locationId skuId qty').lean(),
  ]);

  const key = (locationId, skuId) => `${locationId}:${skuId}`;
  const expected = new Map(fromHistory.map((row) => [key(row._id.locationId, row._id.skuId), row.qty]));
  const mismatches = [];
  for (const balance of balances) {
    const k = key(balance.locationId, balance.skuId);
    const shouldBe = expected.get(k) ?? 0;
    if (shouldBe !== balance.qty) mismatches.push({ locationId: balance.locationId, skuId: balance.skuId, balance: balance.qty, history: shouldBe });
    expected.delete(k);
  }
  // History for a place that has no balance row at all
  for (const [k, qty] of expected) {
    if (qty !== 0) {
      const [locationId, skuId] = k.split(':');
      mismatches.push({ locationId, skuId, balance: 0, history: qty });
    }
  }
  return mismatches;
}
