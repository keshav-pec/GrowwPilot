import { OccasionCampaign, OccasionSettings, OfferIssue, User } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { logActivity } from '../../activity/activity.service.js';
import { notify } from '../../notifications/notifications.service.js';
import { assertCan } from '../permissions.js';
import { addOfferEvents } from './events.js';
import { runForOrg } from './scheduler.js';

// POST /api/occasions/settings/run-now — "Check now": this month's run for every branch again. Nothing is ever given twice.
export async function runNow(ctx) {
  assertCan(ctx, 'occasions.runEngine');
  if (!ctx.occasionOffers) throw new AppError(409, 'FEATURE_OFF', 'Switch on Birthday & Anniversary Offers first');
  const result = await runForOrg(ctx.orgId, { force: true, by: 'MANUAL' });
  await logActivity(ctx, { action: 'occasions.run_now', summary: `Checked this month’s occasion offers now: ${result.issued} new, ${result.expired} expired` });
  return result;
}

// After a campaign is published or turned back on: give this month's offers straight away
export async function runAfterPublish(ctx) {
  if (!ctx.occasionOffers) return null;
  try {
    return await runForOrg(ctx.orgId, { force: true, by: 'PUBLISH' });
  } catch (err) {
    console.error('Occasion offers: the run after publishing failed (the next scheduled run catches up):', err);
    return null;
  }
}

// POST /api/occasions/campaigns/:id/revoke — emergency withdraw (business owner): every UNUSED offer of the campaign
// for that year is withdrawn, with a reason. Used offers and their bills are untouched. Customers who were already
// contacted get a task "Let the customer know the offer was withdrawn"; the owners get a bell.
export async function revokeCampaignOffers(ctx, campaignId, { year, reason }, key) {
  assertCan(ctx, 'occasions.revokeOffers');
  return runOnce(ctx, { key, operation: 'occasions.campaign.revoke' }, async (session) => {
    const campaign = await OccasionCampaign.findOne(scoped(ctx, { _id: campaignId })).session(session).lean();
    if (!campaign) throw new AppError(404, 'NOT_FOUND', 'Campaign not found');
    const unused = await OfferIssue.find(scoped(ctx, { campaignId: campaign._id, year, status: 'ISSUED' })).select('customerId task.contactedAt').session(session).lean();
    const now = new Date();
    const contacted = unused.filter((o) => o.task?.contactedAt);
    const quiet = unused.filter((o) => !o.task?.contactedAt);
    const base = { status: 'REVOKED', revokedReason: reason };
    if (contacted.length) {
      await OfferIssue.updateMany(
        { _id: { $in: contacted.map((o) => o._id) }, status: 'ISSUED' },
        { $set: { ...base, 'task.state': 'OPEN', 'task.kind': 'WITHDRAWN_NOTICE', 'task.dueAt': now, 'task.closedReason': null, 'task.closedAt': null } },
        { session }
      );
    }
    if (quiet.length) {
      await OfferIssue.updateMany(
        { _id: { $in: quiet.map((o) => o._id) }, status: 'ISSUED' },
        { $set: { ...base, 'task.state': 'CLOSED', 'task.closedReason': 'WITHDRAWN', 'task.closedAt': now } },
        { session }
      );
    }
    await addOfferEvents(ctx.orgId, unused, 'REVOKED', { ctx, note: reason }, session);
    await logActivity(
      ctx,
      { action: 'occasions.offers_revoked', branchId: campaign.branchId ?? null, summary: `Withdrew ${unused.length} unused offer${unused.length === 1 ? '' : 's'} of ${campaign.name} for ${year}. Reason: ${reason}` },
      session
    );
    const owners = await User.find(scoped(ctx, { role: 'OWNER', status: 'active' })).distinct('_id').session(session);
    await notify(ctx, owners, { message: `${ctx.userName} withdrew ${unused.length} unused ${campaign.name} offer${unused.length === 1 ? '' : 's'} for ${year}${contacted.length ? `; ${contacted.length} contacted customer${contacted.length === 1 ? '' : 's'} to let know` : ''}`, link: `/app/settings/occasions/campaigns/${campaign._id}` }, session);
    return { revoked: unused.length, toTell: contacted.length };
  });
}

// The "Last successful run" line on the settings page
export async function lastRun(ctx) {
  const settings = await OccasionSettings.findOne(scoped(ctx)).select('lastRun').lean();
  return settings?.lastRun?.at ? settings.lastRun : null;
}
