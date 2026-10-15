import { actorRole, logActivity } from '../activity/activity.service.js';
import { businessOwnerIds, notify } from '../notifications/notifications.service.js';

// Inventory changes go into the activity log. When someone other than the business owner makes them,
// the business owner also gets a bell message.
export async function recordInventoryAction(ctx, { action, branchId, summary, before, after, link = '/app/inventory' }, session) {
  await logActivity(ctx, { action, branchId, summary, before, after }, session);
  if (!ctx.isPrimaryOwner) {
    await notify(ctx, await businessOwnerIds(ctx), { message: `${ctx.userName} (${actorRole(ctx)}): ${summary}`, link }, session);
  }
}
