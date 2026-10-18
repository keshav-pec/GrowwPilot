import { ActivityLog } from '../../models/index.js';
import { scoped } from '../../utils/scoped.js';

const PAGE_SIZE = 25;

// "Business owner" (sees every branch), "Branch owner", "Front desk" or "Inventory"
export function actorRole(ctx) {
  if (ctx.role === 'FRONT_DESK') return 'Front desk';
  if (ctx.role === 'INVENTORY') return 'Inventory';
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

// Inventory actions are named inventory.*, billing actions billing.*; every other logged action is a pay change
const AREAS = {
  inventory: { action: /^inventory\./ },
  billing: { action: /^billing\./ },
  payroll: { action: { $not: /^(inventory|billing)\./ } },
};

// Newest first. The business owner sees every branch; a branch owner only their own branches.
// `area` shows only pay changes, stock changes or billing changes.
export async function listActivity(ctx, { page, area }) {
  const filter = ctx.isPrimaryOwner ? scoped(ctx) : scoped(ctx, { branchId: { $in: ctx.allowedBranchIds } });
  if (area) Object.assign(filter, AREAS[area]);
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
