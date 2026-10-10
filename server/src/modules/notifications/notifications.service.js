import { Notification, User } from '../../models/index.js';
import { scoped } from '../../utils/scoped.js';

// Puts one message in each listed user's bell (the person who did the action is skipped)
export async function notify(ctx, userIds, { message, link }, session) {
  const recipients = [...new Set(userIds.map(String))].filter((id) => id !== ctx.userId);
  if (recipients.length === 0) return;
  await Notification.create(
    recipients.map((userId) => ({ orgId: ctx.orgId, userId, message, link })),
    { session, ordered: true } // ordered is required when creating several documents in a transaction
  );
}

// The salon's business owner(s): owners who see every branch
export async function businessOwnerIds(ctx) {
  return User.find(scoped(ctx, { role: 'OWNER', allBranches: true, status: 'active' })).distinct('_id');
}

// Everyone who may approve a change at this branch: its branch owners and the business owner(s)
export async function branchApproverIds(ctx, branchId) {
  return User.find(
    scoped(ctx, { role: 'OWNER', status: 'active', $or: [{ allBranches: true }, { branchIds: branchId }] })
  ).distinct('_id');
}

// The latest messages in my bell, and how many I haven't read
export async function listNotifications(ctx) {
  const mine = scoped(ctx, { userId: ctx.userId });
  const [items, unread] = await Promise.all([
    Notification.find(mine).sort({ createdAt: -1 }).limit(20).lean(),
    Notification.countDocuments({ ...mine, readAt: null }),
  ]);
  return { items, unread };
}

// Marks the given messages as read, or all of them if no ids are given. Only ever my own.
export async function markRead(ctx, ids) {
  const filter = scoped(ctx, { userId: ctx.userId, readAt: null });
  if (ids?.length) filter._id = { $in: ids };
  await Notification.updateMany(filter, { $set: { readAt: new Date() } });
  return listNotifications(ctx);
}
