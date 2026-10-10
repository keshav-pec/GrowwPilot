import { ActivityLog } from '../../models/index.js';
import { scoped } from '../../utils/scoped.js';

const PAGE_SIZE = 25;

// "Business owner" (sees every branch), "Branch owner" or "Front desk"
export function actorRole(ctx) {
  if (ctx.role === 'FRONT_DESK') return 'Front desk';
  return ctx.isPrimaryOwner ? 'Business owner' : 'Branch owner';
}

// Adds one row to the activity log. Pass the transaction's session so the row is saved
// together with the change it describes (or not at all).
export async function logActivity(ctx, { action, branchId, staffId, summary, before, after }, session) {
  await ActivityLog.create(
    [{ orgId: ctx.orgId, branchId, staffId, actorId: ctx.userId, actorName: ctx.userName, actorRole: actorRole(ctx), action, summary, before, after }],
    { session }
  );
}

// Newest first. The business owner sees every branch; a branch owner only their own branches.
export async function listActivity(ctx, { page }) {
  const filter = ctx.isPrimaryOwner ? scoped(ctx) : scoped(ctx, { branchId: { $in: ctx.allowedBranchIds } });
  const [items, total] = await Promise.all([
    ActivityLog.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .populate('branchId', 'name')
      .lean(),
    ActivityLog.countDocuments(filter),
  ]);
  return { items, page, pages: Math.max(Math.ceil(total / PAGE_SIZE), 1), total };
}
