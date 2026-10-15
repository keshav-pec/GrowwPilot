import {
  InventoryAllocation,
  InventoryAllocationEvent,
  InventoryApproval,
  InventoryLedgerEntry,
  InventoryLocation,
  InventorySku,
  InventorySkuBranch,
  InventoryTransaction,
  User,
} from '../../../models/index.js';
import { REASON_BUCKET } from '../../../config/inventory.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { formatAmount } from '../../../utils/money.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { actorRole } from '../../activity/activity.service.js';
import { notify } from '../../notifications/notifications.service.js';
import { assertCan, can } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { postMovement } from '../stock/stock.engine.js';
import { branchStock } from '../stock/stock.queries.js';
import { ensureBranchLocations } from '../locations/locations.service.js';
import { takeFromHandout } from '../allocations/allocations.service.js';
import { describeQty } from '../units.js';

export const REASON_WORDS = {
  DIRECT_USE: 'used',
  DAMAGE: 'damaged',
  EXPIRY: 'expired',
  LOSS: 'lost',
  SPILLAGE: 'spilled',
  STOCK_COUNT_CORRECTION: 'count corrected',
  OTHER: 'other',
};

export const personOf = (ctx) => ({ id: ctx.userId, name: ctx.userName, role: actorRole(ctx) });

// "Wrote off 2 bottles of Shampoo (damaged)" / "Used 1 kit of Facial kit" / "Corrected the count of Wax: 2 jars more"
function describeWriteOff({ sku, qty, reason, direction }) {
  if (reason === 'STOCK_COUNT_CORRECTION') return `Corrected the count of ${sku.name}: ${describeQty(qty, sku)} ${direction === 'ADD' ? 'more' : 'less'}`;
  if (reason === 'DIRECT_USE') return `Used ${describeQty(qty, sku)} of ${sku.name}`;
  return `Wrote off ${describeQty(qty, sku)} of ${sku.name} (${REASON_WORDS[reason]})`;
}

// Posts a use / write-off / count correction. Shared by a direct write-off and an approved one.
// From a store (locationId) or from a hand-out in use (allocation).
export async function postWriteOff(ctx, { branchId, sku, locationId, allocation, qty, reason, direction, note, actor, approvedBy, requestKey }, session) {
  let from = locationId;
  let heldBy;
  if (allocation) {
    await takeFromHandout(ctx, allocation, qty, session);
    from = (await InventoryLocation.findOne(scoped(ctx, { branchId, kind: 'IN_USE' })).session(session).lean())._id;
    heldBy = allocation.recipient;
  }
  const { transaction } = await postMovement(
    ctx,
    {
      branchId,
      type: reason === 'STOCK_COUNT_CORRECTION' ? 'ADJUSTMENT' : 'WRITE_OFF',
      reason,
      note,
      heldBy,
      reference: allocation ? { kind: 'allocation', id: allocation._id } : undefined,
      actor,
      approvedBy,
      requestKey,
      lines: [{ skuId: sku._id, locationId: from, qty: direction === 'ADD' ? qty : -qty, bucket: REASON_BUCKET[reason] }],
    },
    session
  );
  if (allocation) {
    await InventoryAllocationEvent.create(
      [{ orgId: ctx.orgId, branchId, allocationId: allocation._id, type: 'WRITTEN_OFF', qty, from: allocation.recipient, transactionId: transaction._id, actorId: ctx.userId, actorName: ctx.userName, note }],
      { session }
    );
  }
  const summary = describeWriteOff({ sku, qty, reason, direction }) + (approvedBy ? `, approved by ${approvedBy.name}` : '');
  await recordInventoryAction(
    ctx,
    { action: 'inventory.write_off', branchId, summary, after: { qty, reason, direction, note }, link: `/app/inventory?tab=products&product=${sku._id}` },
    session
  );
  return transaction;
}

// Owners who may approve a write-off of this value at this branch (the business owner always;
// a branch owner only within their limit)
async function writeOffApproverIds(ctx, branchId, value, settings) {
  const owners = await User.find(scoped(ctx, { role: 'OWNER', status: 'active', $or: [{ allBranches: true }, { branchIds: branchId }] })).lean();
  return owners
    .filter((o) => {
      const decision = can({ role: 'OWNER', isPrimaryOwner: o.allBranches }, 'inventory.writeOff', { settings, value: value ?? undefined });
      return decision.allowed && !decision.needsApproval;
    })
    .map((o) => o._id);
}

// A pending problem report from the front desk, closed by the write-off made for it
async function closeReport(ctx, reportId, { decisionNote, transactionId }, session) {
  if (!reportId) return;
  const closed = await InventoryApproval.updateOne(
    scoped(ctx, { _id: reportId, kind: 'PROBLEM_REPORT', status: 'PENDING' }),
    { $set: { status: 'RESOLVED', decidedBy: personOf(ctx), decidedAt: new Date(), decisionNote, transactionId } },
    { session }
  );
  if (closed.modifiedCount === 0) throw new AppError(409, 'ALREADY_DECIDED', 'This problem report has already been dealt with');
}

// ---------------------------------------------------------------------------
// Use, write-off or count correction by hand (INV-08).
// input: { skuId, locationId | allocationId, qty, reason, direction ('REMOVE' | 'ADD'), note?, reportId? }
// Within the person's limit it is posted at once. Above it, a note is needed and it waits for an owner.
// The front desk can never do this; they report a problem instead.
// ---------------------------------------------------------------------------
export async function writeOff(ctx, input, key) {
  const branchId = ctx.activeBranchId;
  const { qty, reason, direction, note, reportId } = input;
  const settings = await getBranchSettings(ctx, branchId);
  assertCan(ctx, 'inventory.writeOff', { settings, value: 0 }); // the front desk stops here (AC18)

  const [sku, here] = await Promise.all([
    InventorySku.findOne(scoped(ctx, { _id: input.skuId })).lean(),
    InventorySkuBranch.findOne(scoped(ctx, { branchId, skuId: input.skuId })).lean(),
  ]);
  if (!sku || !here) throw new AppError(404, 'NOT_FOUND', 'Product not found at this branch');
  if (direction === 'ADD' && (reason !== 'STOCK_COUNT_CORRECTION' || input.allocationId)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Stock can only be added as a count correction in a store');
  }

  let allocation = null;
  let locationId = null;
  if (input.allocationId) {
    allocation = await InventoryAllocation.findOne(scoped(ctx, { _id: input.allocationId, branchId, skuId: sku._id, status: 'OPEN' })).lean();
    if (!allocation) throw new AppError(404, 'NOT_FOUND', 'Hand-out not found');
  } else {
    await ensureBranchLocations(ctx, branchId);
    const store = await InventoryLocation.findOne(scoped(ctx, { _id: input.locationId, branchId, kind: 'STORE' })).lean();
    if (!store) throw new AppError(404, 'NOT_FOUND', 'Store not found');
    locationId = store._id;
  }

  const value = here.avgCost == null ? null : Math.round(qty * here.avgCost);
  const decision = assertCan(ctx, 'inventory.writeOff', { settings, value: value ?? undefined });

  if (decision.needsApproval) {
    if (!note) throw new AppError(400, 'NOTE_REQUIRED', 'This is above your limit. Add a note saying what happened; an owner will approve it.');
    return runOnce(ctx, { key, operation: 'inventory.writeOff' }, async (session) => {
      const [approval] = await InventoryApproval.create(
        [{ orgId: ctx.orgId, branchId, kind: 'WRITE_OFF', skuId: sku._id, skuName: sku.name, locationId, allocationId: allocation?._id, qty, direction, reason, note, value, requestedBy: personOf(ctx) }],
        { session }
      );
      await closeReport(ctx, reportId, { decisionNote: 'Sent for an owner’s approval' }, session);
      const summary = `${describeWriteOff({ sku, qty, reason, direction })}: waiting for approval${value != null ? ` (${formatAmount(value)})` : ''}`;
      await recordInventoryAction(ctx, { action: 'inventory.write_off_requested', branchId, summary, after: { qty, reason, note }, link: '/app/inventory?tab=overview' }, session);
      await notify(ctx, await writeOffApproverIds(ctx, branchId, value, settings), { message: `${ctx.userName} asks to approve: ${summary}`, link: '/app/inventory?tab=overview' }, session);
      return { status: 'PENDING_APPROVAL', approval: approval.toObject() };
    });
  }

  return runOnce(ctx, { key, operation: 'inventory.writeOff' }, async (session) => {
    const transaction = await postWriteOff(ctx, { branchId, sku, locationId, allocation, qty, reason, direction, note, requestKey: key }, session);
    await closeReport(ctx, reportId, { decisionNote: 'Written off', transactionId: transaction._id }, session);
    const totals = (await branchStock(ctx, branchId, [sku._id], session))[String(sku._id)];
    return { status: 'POSTED', transactionId: transaction._id, totals };
  });
}

// An owner decides on a write-off that was above someone's limit. Approving posts it now,
// recorded as reported by the person who asked and approved by this owner.
export async function decideWriteOff(ctx, id, { approve, note }, key) {
  const approval = await InventoryApproval.findOne(scoped(ctx, { _id: id, kind: 'WRITE_OFF', branchId: { $in: ctx.allowedBranchIds } })).lean();
  if (!approval) throw new AppError(404, 'NOT_FOUND', 'Request not found');
  if (approval.status !== 'PENDING') throw new AppError(409, 'ALREADY_DECIDED', 'This request has already been decided');
  if (String(approval.requestedBy.id) === ctx.userId) throw new AppError(403, 'PERMISSION_DENIED', 'Someone else has to approve your own request');
  const settings = await getBranchSettings(ctx, approval.branchId);
  const decision = can(ctx, 'inventory.writeOff', { settings, value: approval.value ?? undefined });
  if (!decision.allowed || decision.needsApproval) {
    throw new AppError(403, 'PERMISSION_DENIED', 'This is above your approval limit. The business owner decides.');
  }

  return runOnce(ctx, { key, operation: 'inventory.writeOff.decide' }, async (session) => {
    const status = approve ? 'APPROVED' : 'REJECTED';
    const marked = await InventoryApproval.updateOne(
      scoped(ctx, { _id: approval._id, status: 'PENDING' }),
      { $set: { status, decidedBy: personOf(ctx), decidedAt: new Date(), decisionNote: note } },
      { session }
    );
    if (marked.modifiedCount === 0) throw new AppError(409, 'ALREADY_DECIDED', 'This request has already been decided');

    const sku = await InventorySku.findOne(scoped(ctx, { _id: approval.skuId })).session(session).lean();
    if (approve) {
      const allocation = approval.allocationId ? await InventoryAllocation.findOne(scoped(ctx, { _id: approval.allocationId })).session(session).lean() : null;
      const transaction = await postWriteOff(
        ctx,
        {
          branchId: approval.branchId,
          sku,
          locationId: approval.locationId,
          allocation,
          qty: approval.qty,
          reason: approval.reason,
          direction: approval.direction,
          note: approval.note,
          actor: approval.requestedBy,
          approvedBy: { id: ctx.userId, name: ctx.userName },
          requestKey: key,
        },
        session
      );
      await InventoryApproval.updateOne(scoped(ctx, { _id: approval._id }), { $set: { transactionId: transaction._id } }, { session });
    } else {
      await recordInventoryAction(
        ctx,
        { action: 'inventory.write_off_rejected', branchId: approval.branchId, summary: `Turned down: ${describeWriteOff({ sku, ...approval })}${note ? `. ${note}` : ''}` },
        session
      );
    }
    const verb = approve ? 'approved' : 'turned down';
    await notify(ctx, [approval.requestedBy.id], { message: `${ctx.userName} ${verb} your request: ${describeWriteOff({ sku, ...approval })}`, link: '/app/inventory?tab=overview' }, session);
    return { status };
  });
}

// ---------------------------------------------------------------------------
// Fixing a mistaken finish: an owner posts a correction that points at the original and puts the
// stock back into the hand-out. Nothing is deleted, and a finish can be corrected only once.
// ---------------------------------------------------------------------------
export async function correctFinish(ctx, transactionId, { note }, key) {
  const branchId = ctx.activeBranchId;
  assertCan(ctx, 'inventory.correctFinish', { settings: await getBranchSettings(ctx, branchId) });
  const original = await InventoryTransaction.findOne(scoped(ctx, { _id: transactionId, branchId, type: 'FINISH' })).lean();
  if (!original) throw new AppError(404, 'NOT_FOUND', 'Finished bottle not found');
  if (await InventoryTransaction.exists(scoped(ctx, { correctsId: original._id }))) {
    throw new AppError(409, 'ALREADY_CORRECTED', 'This has already been corrected');
  }
  const [line] = await InventoryLedgerEntry.find(scoped(ctx, { transactionId: original._id })).lean();
  const sku = await InventorySku.findOne(scoped(ctx, { _id: line.skuId })).lean();

  return runOnce(ctx, { key, operation: 'inventory.finish.correct' }, async (session) => {
    const allocation = await InventoryAllocation.findOneAndUpdate(
      scoped(ctx, { _id: original.reference.id }),
      { $inc: { remainingQty: -line.qty, version: 1 }, $set: { status: 'OPEN', closedAt: null } },
      { returnDocument: 'after', session }
    ).lean();
    const { transaction } = await postMovement(
      ctx,
      {
        branchId,
        type: 'CORRECTION',
        note,
        heldBy: original.heldBy,
        reference: original.reference,
        correctsId: original._id,
        requestKey: key,
        lines: [{ skuId: line.skuId, locationId: line.locationId, qty: -line.qty, bucket: line.bucket, unitCost: line.unitCost }],
      },
      session
    );
    await InventoryAllocationEvent.create(
      [{ orgId: ctx.orgId, branchId, allocationId: allocation._id, type: 'CORRECTED', qty: -line.qty, to: allocation.recipient, transactionId: transaction._id, actorId: ctx.userId, actorName: ctx.userName, note }],
      { session }
    );
    await recordInventoryAction(
      ctx,
      { action: 'inventory.finish_corrected', branchId, summary: `Undid a finish of ${describeQty(-line.qty, sku)} of ${sku.name} (${allocation.recipient.name}): ${note}`, link: `/app/inventory?tab=products&product=${sku._id}` },
      session
    );
    return { transactionId: transaction._id, allocation };
  });
}
