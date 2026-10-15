import { InventoryAllocation, InventoryApproval, InventoryLocation, InventorySku, InventorySkuBranch } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { notify } from '../../notifications/notifications.service.js';
import { assertCan, can } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { stockKeeperIds } from '../stock/lowStock.js';
import { describeQty } from '../units.js';
import { personOf, REASON_WORDS } from '../movements/movements.service.js';

// ---------------------------------------------------------------------------
// Requests waiting for someone: write-offs above a limit (owners approve) and problems the front desk
// reported (owners and inventory logins write them off or dismiss them).
// ---------------------------------------------------------------------------

// Owners and inventory logins: everything waiting at the selected branch, with whether I may decide it.
// The front desk: the problems they reported themselves, and what happened to them.
export async function listRequests(ctx) {
  const branchId = ctx.activeBranchId;
  const settings = await getBranchSettings(ctx, branchId);
  const handlesRequests = can(ctx, 'inventory.writeOff', { settings, value: 0 }).allowed;

  const filter = handlesRequests
    ? scoped(ctx, { branchId, status: 'PENDING' })
    : scoped(ctx, { branchId, kind: 'PROBLEM_REPORT', 'requestedBy.id': ctx.userId });
  const requests = await InventoryApproval.find(filter).sort({ createdAt: -1 }).limit(handlesRequests ? 100 : 20).lean();
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: requests.map((r) => r.skuId) } }))
    .select('name code stockUnit wayOfUse baseUnit unitsPerStockUnit')
    .lean();
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));
  const canSeeCosts = can(ctx, 'inventory.viewCosts', { settings }).allowed;

  return requests.map((r) => {
    const decision = can(ctx, 'inventory.writeOff', { settings, value: r.value ?? undefined });
    const mayDecide =
      r.status === 'PENDING' &&
      (r.kind === 'PROBLEM_REPORT' ? handlesRequests : decision.allowed && !decision.needsApproval && String(r.requestedBy.id) !== ctx.userId);
    const row = { ...r, sku: skuOf[String(r.skuId)], canDecide: mayDecide };
    if (!canSeeCosts) delete row.value;
    return row;
  });
}

// The front desk (or anyone) reports a problem: broken, expired, lost, spilled, or the count looks wrong.
// input: { skuId, allocationId?, locationId?, reason, qty?, note }
export async function reportProblem(ctx, input, key) {
  const branchId = ctx.activeBranchId;
  assertCan(ctx, 'inventory.reportProblem', { settings: await getBranchSettings(ctx, branchId) });
  const [sku, here] = await Promise.all([
    InventorySku.findOne(scoped(ctx, { _id: input.skuId })).lean(),
    InventorySkuBranch.exists(scoped(ctx, { branchId, skuId: input.skuId })),
  ]);
  if (!sku || !here) throw new AppError(404, 'NOT_FOUND', 'Product not found at this branch');
  if (input.allocationId && !(await InventoryAllocation.exists(scoped(ctx, { _id: input.allocationId, branchId, skuId: sku._id, status: 'OPEN' })))) {
    throw new AppError(404, 'NOT_FOUND', 'Hand-out not found');
  }
  if (input.locationId && !(await InventoryLocation.exists(scoped(ctx, { _id: input.locationId, branchId, kind: 'STORE' })))) {
    throw new AppError(404, 'NOT_FOUND', 'Store not found');
  }

  return runOnce(ctx, { key, operation: 'inventory.problem.report' }, async (session) => {
    const [report] = await InventoryApproval.create(
      [
        {
          orgId: ctx.orgId,
          branchId,
          kind: 'PROBLEM_REPORT',
          skuId: sku._id,
          skuName: sku.name,
          allocationId: input.allocationId ?? null,
          locationId: input.locationId ?? null,
          qty: input.qty ?? null,
          reason: input.reason,
          note: input.note,
          requestedBy: personOf(ctx),
        },
      ],
      { session }
    );
    const amount = input.qty ? `${describeQty(input.qty, sku)} of ` : '';
    await notify(
      ctx,
      await stockKeeperIds(ctx, branchId),
      { message: `${ctx.userName} reported a problem: ${amount}${sku.name} (${REASON_WORDS[input.reason]}). ${input.note}`, link: '/app/inventory?tab=overview' },
      session
    );
    return { report: report.toObject() };
  });
}

// Close a reported problem without writing anything off (e.g. it turned up again)
export async function dismissReport(ctx, id, { note }, key) {
  const branchId = ctx.activeBranchId;
  assertCan(ctx, 'inventory.writeOff', { settings: await getBranchSettings(ctx, branchId), value: 0 });
  const report = await InventoryApproval.findOne(scoped(ctx, { _id: id, branchId, kind: 'PROBLEM_REPORT' })).lean();
  if (!report) throw new AppError(404, 'NOT_FOUND', 'Problem report not found');

  return runOnce(ctx, { key, operation: 'inventory.problem.dismiss' }, async (session) => {
    const closed = await InventoryApproval.updateOne(
      scoped(ctx, { _id: report._id, status: 'PENDING' }),
      { $set: { status: 'DISMISSED', decidedBy: personOf(ctx), decidedAt: new Date(), decisionNote: note } },
      { session }
    );
    if (closed.modifiedCount === 0) throw new AppError(409, 'ALREADY_DECIDED', 'This problem report has already been dealt with');
    await recordInventoryAction(ctx, { action: 'inventory.problem_dismissed', branchId, summary: `Closed ${report.requestedBy.name}’s report about ${report.skuName}: ${note}` }, session);
    await notify(ctx, [report.requestedBy.id], { message: `${ctx.userName} looked at your report about ${report.skuName}: ${note}`, link: '/app/inventory?tab=overview' }, session);
    return { status: 'DISMISSED' };
  });
}
