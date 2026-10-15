import {
  InventoryAllocation,
  InventoryAllocationEvent,
  InventoryBalance,
  InventoryLocation,
  InventorySku,
  InventorySkuBranch,
  Staff,
} from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { postMovement } from '../stock/stock.engine.js';
import { branchStock, availableToIssue } from '../stock/stock.queries.js';
import { refreshLowStock, stockKeeperIds } from '../stock/lowStock.js';
import { notify } from '../../notifications/notifications.service.js';
import { ensureBranchLocations } from '../locations/locations.service.js';
import { describeQty } from '../units.js';

// ---------------------------------------------------------------------------
// Hand-outs ("In use"): stock issued from a store to the salon floor, a station or a stylist.
// Issuing moves stock from the store to In use (the branch total doesn't change). It is used up only
// when someone marks it Finished. It can also be returned unused, or moved to someone else.
// ---------------------------------------------------------------------------

const FLOOR = { kind: 'FLOOR', id: null, name: 'Salon floor' };

async function allow(ctx, action) {
  assertCan(ctx, action, { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
}

// A product used at this branch (deactivated products can't be handed out)
async function findSkuHere(ctx, branchId, skuId) {
  const [sku, here] = await Promise.all([
    InventorySku.findOne(scoped(ctx, { _id: skuId })).lean(),
    InventorySkuBranch.exists(scoped(ctx, { branchId, skuId, active: true })),
  ]);
  if (!sku || !here) throw new AppError(404, 'NOT_FOUND', 'Product not found at this branch');
  if (sku.status !== 'active') throw new AppError(409, 'PRODUCT_INACTIVE', `${sku.name} is deactivated`);
  return sku;
}

// A store at this branch that is open
async function findStore(ctx, branchId, locationId) {
  const store = await InventoryLocation.findOne(scoped(ctx, { _id: locationId, branchId, kind: 'STORE', active: true })).lean();
  if (!store) throw new AppError(404, 'NOT_FOUND', 'Store not found');
  return store;
}

// Who gets it: { kind: 'FLOOR' } | { kind: 'STATION', id } | { kind: 'STAFF', id } -> { kind, id, name }
async function findRecipient(ctx, branchId, { kind, id }) {
  if (kind === 'FLOOR') return FLOOR;
  const found =
    kind === 'STATION'
      ? await InventoryLocation.findOne(scoped(ctx, { _id: id, branchId, kind: 'STATION', active: true })).lean()
      : await Staff.findOne(scoped(ctx, { _id: id, branchId, status: 'active' })).lean();
  if (!found) throw new AppError(404, 'NOT_FOUND', kind === 'STATION' ? 'Station not found' : 'Team member not found');
  return { kind, id: found._id, name: found.name };
}

async function findHandout(ctx, id) {
  const allocation = await InventoryAllocation.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId })).lean();
  if (!allocation) throw new AppError(404, 'NOT_FOUND', 'Hand-out not found');
  return allocation;
}

const actorOf = (ctx) => ({ actorId: ctx.userId, actorName: ctx.userName });

async function addEvent(ctx, allocation, event, session) {
  await InventoryAllocationEvent.create([{ orgId: ctx.orgId, branchId: allocation.branchId, allocationId: allocation._id, ...actorOf(ctx), ...event }], { session });
}

// Takes qty out of an open hand-out. Only matches while it is open and has that much left, so two people
// finishing the same bottle at the same moment can never use more than was handed out (AC07).
export async function takeFromHandout(ctx, allocation, qty, session) {
  const updated = await InventoryAllocation.findOneAndUpdate(
    scoped(ctx, { _id: allocation._id, status: 'OPEN', remainingQty: { $gte: qty } }),
    { $inc: { remainingQty: -qty, version: 1 } },
    { returnDocument: 'after', session }
  );
  if (!updated) {
    const now = await InventoryAllocation.findOne(scoped(ctx, { _id: allocation._id })).session(session).lean();
    if (now.status === 'CLOSED') throw new AppError(409, 'ALLOCATION_ALREADY_CLOSED', 'This hand-out is already closed');
    throw new AppError(409, 'INSUFFICIENT_AVAILABLE_STOCK', `Only ${now.remainingQty} left in this hand-out`, { available: now.remainingQty });
  }
  if (updated.remainingQty === 0) {
    updated.status = 'CLOSED';
    updated.closedAt = new Date();
    await updated.save({ session });
  }
  return updated.toObject();
}

// Store -> In use, and a new hand-out. Used by Issue, and by Finish & replace.
async function issueStock(ctx, { sku, branchId, store, inUse, recipient, qty, note, replacesId, requestKey }, session) {
  const { transaction } = await postMovement(
    ctx,
    {
      branchId,
      type: 'ISSUE',
      note,
      heldBy: recipient,
      requestKey,
      lines: [
        { skuId: sku._id, locationId: store._id, qty: -qty, bucket: 'MOVED' },
        { skuId: sku._id, locationId: inUse._id, qty, bucket: 'MOVED' },
      ],
    },
    session
  );
  const [allocation] = await InventoryAllocation.create(
    [{ orgId: ctx.orgId, branchId, skuId: sku._id, recipient, issuedQty: qty, remainingQty: qty, replacesId }],
    { session }
  );
  await addEvent(ctx, allocation, { type: 'ISSUED', qty, to: recipient, transactionId: transaction._id, note }, session);
  return allocation.toObject();
}

async function totalsFor(ctx, branchId, skuId, session) {
  const { inStore, inUse } = (await branchStock(ctx, branchId, [skuId], session))[String(skuId)];
  return { inStore, inUse, available: availableToIssue({ inStore }) };
}

// ---------------------------------------------------------------------------
// Issue product (INV-05): choose a product, the store, who gets it and how many
// ---------------------------------------------------------------------------
export async function issue(ctx, input, key) {
  await allow(ctx, 'inventory.issue');
  const branchId = ctx.activeBranchId;
  const sku = await findSkuHere(ctx, branchId, input.skuId);
  const { inUse } = await ensureBranchLocations(ctx, branchId);
  const store = await findStore(ctx, branchId, input.locationId);
  const recipient = await findRecipient(ctx, branchId, input.recipient);

  return runOnce(ctx, { key, operation: 'inventory.allocation.issue' }, async (session) => {
    const allocation = await issueStock(ctx, { sku, branchId, store, inUse, recipient, qty: input.qty, note: input.note, requestKey: key }, session);
    return { allocation, totals: await totalsFor(ctx, branchId, sku._id, session) };
  });
}

// ---------------------------------------------------------------------------
// Finish & replace (INV-07), in one step. The finish is always saved. A replacement is issued only if
// the store has enough; if not, the answer says UNAVAILABLE and the product is flagged as low stock.
// ---------------------------------------------------------------------------
export async function finish(ctx, id, { qty, note, replacement }, key) {
  await allow(ctx, 'inventory.finish');
  if (replacement) await allow(ctx, 'inventory.issue');
  const branchId = ctx.activeBranchId;
  const allocation = await findHandout(ctx, id);
  const sku = await InventorySku.findOne(scoped(ctx, { _id: allocation.skuId })).lean();
  const { mainStore, inUse } = await ensureBranchLocations(ctx, branchId);
  const store = replacement ? await findStore(ctx, branchId, replacement.locationId ?? mainStore._id) : null;
  const newRecipient = replacement?.recipient ? await findRecipient(ctx, branchId, replacement.recipient) : allocation.recipient;

  return runOnce(ctx, { key, operation: 'inventory.allocation.finish' }, async (session) => {
    const remaining = await takeFromHandout(ctx, allocation, qty, session);
    const { transaction } = await postMovement(
      ctx,
      {
        branchId,
        type: 'FINISH',
        note,
        heldBy: allocation.recipient,
        reference: { kind: 'allocation', id: allocation._id },
        requestKey: key,
        lines: [{ skuId: sku._id, locationId: inUse._id, qty: -qty, bucket: 'CONSUMED' }],
      },
      session
    );
    await addEvent(ctx, allocation, { type: 'FINISHED', qty, from: allocation.recipient, transactionId: transaction._id, note }, session);

    let replacementResult = { status: 'NOT_REQUESTED', allocationId: null };
    if (replacement) {
      const inStore = await InventoryBalance.findOne(scoped(ctx, { locationId: store._id, skuId: sku._id })).session(session).lean();
      if ((inStore?.qty ?? 0) >= replacement.qty) {
        const issued = await issueStock(
          ctx,
          { sku, branchId, store, inUse, recipient: newRecipient, qty: replacement.qty, replacesId: allocation._id, requestKey: key },
          session
        );
        replacementResult = { status: 'ISSUED', allocationId: issued._id };
      } else {
        // Not enough in the store: the finish stays, and the low-stock alert goes out
        replacementResult = { status: 'UNAVAILABLE', allocationId: null, available: inStore?.qty ?? 0 };
        await refreshLowStock(ctx, branchId, [sku._id], session);
      }
    }

    return { allocation: remaining, finished: qty, replacement: replacementResult, totals: await totalsFor(ctx, branchId, sku._id, session) };
  });
}

// ---------------------------------------------------------------------------
// Return unused (In use -> a store), when it can still be used
// ---------------------------------------------------------------------------
export async function returnUnused(ctx, id, { qty, locationId, note }, key) {
  await allow(ctx, 'inventory.return');
  const branchId = ctx.activeBranchId;
  const allocation = await findHandout(ctx, id);
  const { mainStore, inUse } = await ensureBranchLocations(ctx, branchId);
  const store = await findStore(ctx, branchId, locationId ?? mainStore._id);

  return runOnce(ctx, { key, operation: 'inventory.allocation.return' }, async (session) => {
    const remaining = await takeFromHandout(ctx, allocation, qty, session);
    const { transaction } = await postMovement(
      ctx,
      {
        branchId,
        type: 'RETURN',
        note,
        heldBy: allocation.recipient,
        reference: { kind: 'allocation', id: allocation._id },
        requestKey: key,
        lines: [
          { skuId: allocation.skuId, locationId: inUse._id, qty: -qty, bucket: 'MOVED' },
          { skuId: allocation.skuId, locationId: store._id, qty, bucket: 'MOVED' },
        ],
      },
      session
    );
    await addEvent(ctx, allocation, { type: 'RETURNED', qty, from: allocation.recipient, transactionId: transaction._id, note }, session);
    return { allocation: remaining, totals: await totalsFor(ctx, branchId, allocation.skuId, session) };
  });
}

// ---------------------------------------------------------------------------
// Move to another stylist or station. Nothing is used up and the branch total stays the same;
// the movement history records who had it before and after (AC08). Moving part of it splits the hand-out.
// Moving also settles a "needs handover" flag.
// ---------------------------------------------------------------------------
export async function move(ctx, id, input, key) {
  await allow(ctx, 'inventory.transfer');
  const branchId = ctx.activeBranchId;
  const allocation = await findHandout(ctx, id);
  const to = await findRecipient(ctx, branchId, input.recipient);
  const { inUse } = await ensureBranchLocations(ctx, branchId);
  const qty = input.qty ?? allocation.remainingQty;
  if (to.kind === allocation.recipient.kind && String(to.id) === String(allocation.recipient.id)) {
    throw new AppError(400, 'VALIDATION_ERROR', `${to.name} already has it`);
  }

  return runOnce(ctx, { key, operation: 'inventory.allocation.move' }, async (session) => {
    const remaining = await takeFromHandout(ctx, allocation, qty, session);
    const { transaction } = await postMovement(
      ctx,
      {
        branchId,
        type: 'TRANSFER',
        note: input.note,
        heldBy: to,
        reference: { kind: 'allocation', id: allocation._id },
        requestKey: key,
        lines: [
          { skuId: allocation.skuId, locationId: inUse._id, qty: -qty, bucket: 'MOVED' },
          { skuId: allocation.skuId, locationId: inUse._id, qty, bucket: 'MOVED' },
        ],
      },
      session
    );
    // The moved part continues as a hand-out to the new person; the old one keeps its own history
    const [moved] = await InventoryAllocation.create(
      [{ orgId: ctx.orgId, branchId, skuId: allocation.skuId, recipient: to, issuedQty: qty, remainingQty: qty, replacesId: allocation.replacesId }],
      { session }
    );
    await addEvent(ctx, allocation, { type: 'MOVED', qty, from: allocation.recipient, to, transactionId: transaction._id, note: input.note }, session);
    await addEvent(ctx, moved, { type: 'MOVED', qty, from: allocation.recipient, to, transactionId: transaction._id, note: input.note }, session);
    return { allocation: remaining, moved: moved.toObject() };
  });
}

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

// Open hand-outs at the selected branch, oldest first. A finish-mode product, or a hand-out that was itself
// a replacement, is "usually replaced", so the Finish screen ticks "issue a replacement" for it.
export async function listHandouts(ctx, { skuId } = {}) {
  const filter = scoped(ctx, { branchId: ctx.activeBranchId, status: 'OPEN' });
  if (skuId) filter.skuId = skuId;
  const handouts = await InventoryAllocation.find(filter).sort({ createdAt: 1 }).lean();
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: handouts.map((h) => h.skuId) } }))
    .select('name code stockUnit wayOfUse baseUnit unitsPerStockUnit')
    .lean();
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));
  return handouts.map((h) => ({ ...h, sku: skuOf[String(h.skuId)], usuallyReplaced: skuOf[String(h.skuId)]?.wayOfUse === 'FINISH' || Boolean(h.replacesId) }));
}

// Who can receive stock at the selected branch: the floor, its stations and its team
export async function listRecipients(ctx) {
  const branchId = ctx.activeBranchId;
  const [stations, staff] = await Promise.all([
    InventoryLocation.find(scoped(ctx, { branchId, kind: 'STATION', active: true })).select('name').sort('name').lean(),
    Staff.find(scoped(ctx, { branchId, status: 'active' })).select('name role').sort('name').lean(),
  ]);
  return { floor: FLOOR, stations, staff };
}

// When a team member stops working here, their open hand-outs are flagged "needs handover"
// and the owners and inventory logins are told (PRD AC26). Called from setStaffStatus.
export async function flagHandoverForStaff(ctx, staff) {
  const open = await InventoryAllocation.find(scoped(ctx, { 'recipient.kind': 'STAFF', 'recipient.id': staff._id, status: 'OPEN', needsHandover: false })).lean();
  if (open.length === 0) return 0;
  await InventoryAllocation.updateMany(scoped(ctx, { _id: { $in: open.map((a) => a._id) } }), { $set: { needsHandover: true } });
  await InventoryAllocationEvent.create(
    open.map((a) => ({ orgId: ctx.orgId, branchId: a.branchId, allocationId: a._id, type: 'HANDOVER_NEEDED', qty: a.remainingQty, from: a.recipient, ...actorOf(ctx) })),
    { ordered: true }
  );
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: open.map((a) => a.skuId) } })).select('name stockUnit wayOfUse baseUnit unitsPerStockUnit').lean();
  const what = open.map((a) => {
    const sku = skus.find((s) => String(s._id) === String(a.skuId));
    return `${describeQty(a.remainingQty, sku)} of ${sku.name}`;
  });
  await notify(ctx, await stockKeeperIds(ctx, staff.branchId), {
    message: `${staff.name} still has ${what.join(', ')}. Move ${open.length === 1 ? 'it' : 'them'} to someone else in Inventory.`,
    link: '/app/inventory?tab=overview',
  });
  return open.length;
}
