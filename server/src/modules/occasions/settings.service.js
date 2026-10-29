import { Customer, OccasionSettings, Organization, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { CHANNEL_LABELS, CONSENT_CHANNELS } from '../../config/occasions.js';
import { assertCan, capabilities } from './permissions.js';

// The salon's settings row, made with the defaults the first time it is needed
export async function getOccasionSettings(ctx, session = null) {
  return OccasionSettings.findOneAndUpdate(scoped(ctx), { $setOnInsert: { orgId: ctx.orgId } }, { upsert: true, returnDocument: 'after', session }).lean();
}

// The consent sentence as the customer sees it: "... from Glamour Studio on WhatsApp ..."
export function consentWording(text, salonName, channel) {
  return text.replaceAll('{salon_name}', salonName ?? 'the salon').replaceAll('{channel}', CHANNEL_LABELS[channel] ?? channel);
}

// The customers this user looks after: the whole salon for the business owner, otherwise their branches' customers
export function customerScope(ctx, extra = {}) {
  return ctx.isPrimaryOwner ? scoped(ctx, extra) : scoped(ctx, { homeBranchId: { $in: ctx.allowedBranchIds }, ...extra });
}

// The three counts next to the switch: how many customers have a birthday month, an anniversary month,
// and at least one channel they may be messaged on
export async function dataCounts(ctx) {
  const optedIn = { $or: CONSENT_CHANNELS.map((channel) => ({ [`marketing.${channel}.status`]: 'OPTED_IN' })) };
  const [customers, birthdayKnown, anniversaryKnown, canMessage] = await Promise.all([
    Customer.countDocuments(customerScope(ctx)),
    Customer.countDocuments(customerScope(ctx, { 'occasions.birthday.month': { $gte: 1 } })),
    Customer.countDocuments(customerScope(ctx, { 'occasions.anniversary.month': { $gte: 1 } })),
    Customer.countDocuments(customerScope(ctx, optedIn)),
  ]);
  return { customers, birthdayKnown, anniversaryKnown, canMessage };
}

// Settings → Occasion offers. Owners see it; only the business owner changes it.
export async function getSettingsForScreen(ctx) {
  assertCan(ctx, 'occasions.viewSettings');
  const [settings, org, counts] = await Promise.all([
    getOccasionSettings(ctx),
    Organization.findById(ctx.orgId).select('name occasionOffers').lean(),
    dataCounts(ctx),
  ]);
  const switchInfo = org?.occasionOffers ?? {};
  const changedById = switchInfo.enabled ? switchInfo.enabledBy : switchInfo.disabledBy;
  const changedBy = changedById ? await User.findOne(scoped(ctx, { _id: changedById })).select('name').lean() : null;
  return {
    enabled: Boolean(switchInfo.enabled),
    changedAt: (switchInfo.enabled ? switchInfo.enabledAt : switchInfo.disabledAt) ?? null,
    changedByName: changedBy?.name ?? null,
    salonName: org?.name,
    consentText: settings.consentText,
    noticeVersion: settings.noticeVersion,
    channelOrder: settings.channelOrder,
    version: settings.version,
    counts,
    can: capabilities(ctx),
  };
}

// input: { enabled?, consentText?, channelOrder? }; version: what the screen loaded (If-Match).
// Switching on doesn't publish or send anything: it only lets the salon use the feature.
export async function updateSettings(ctx, input, { version, key }) {
  assertCan(ctx, 'occasions.manageSettings');
  await getOccasionSettings(ctx); // make sure the row exists, so the change below is a plain guarded update

  return runOnce(ctx, { key, operation: 'occasions.settings.update' }, async (session) => {
    // One after the other: a transaction can't run two reads at once
    const before = await OccasionSettings.findOne(scoped(ctx)).session(session).lean();
    const org = await Organization.findById(ctx.orgId).select('occasionOffers').session(session).lean();
    if (before.version !== version) {
      throw new AppError(409, 'STALE_SETTINGS', 'Someone else changed these settings a moment ago. Please reload and try again.');
    }

    const set = {};
    const words = [];
    if (input.consentText !== undefined && input.consentText !== before.consentText) {
      const next = Number(String(before.noticeVersion).replace(/\D/g, '') || 1) + 1;
      set.consentText = input.consentText;
      set.noticeVersion = `v${next}`;
      words.push(`consent wording changed (now ${set.noticeVersion})`);
    }
    if (input.channelOrder !== undefined && input.channelOrder.join() !== before.channelOrder.join()) {
      set.channelOrder = input.channelOrder;
      words.push(`channel order: ${input.channelOrder.map((c) => CHANNEL_LABELS[c]).join(' > ')}`);
    }
    const wasOn = Boolean(org?.occasionOffers?.enabled);
    const switching = input.enabled !== undefined && input.enabled !== wasOn;

    const saved = await OccasionSettings.updateOne(
      scoped(ctx, { version }),
      { $set: { ...set, updatedBy: ctx.userId }, $inc: { version: 1 } },
      { session, runValidators: true }
    );
    if (saved.matchedCount !== 1) {
      throw new AppError(409, 'STALE_SETTINGS', 'Someone else changed these settings a moment ago. Please reload and try again.');
    }

    if (switching) {
      const now = new Date();
      const change = input.enabled
        ? { 'occasionOffers.enabled': true, 'occasionOffers.enabledAt': now, 'occasionOffers.enabledBy': ctx.userId }
        : { 'occasionOffers.enabled': false, 'occasionOffers.disabledAt': now, 'occasionOffers.disabledBy': ctx.userId };
      await Organization.updateOne({ _id: ctx.orgId }, { $set: change }, { session });
      await logActivity(
        ctx,
        { action: input.enabled ? 'occasions.enabled' : 'occasions.disabled', summary: `${input.enabled ? 'Switched on' : 'Switched off'} Birthday & Anniversary Offers` },
        session
      );
    }
    if (words.length > 0) {
      await logActivity(
        ctx,
        { action: 'occasions.settings_changed', summary: `Changed occasion offer settings: ${words.join('; ')}`, before: { consentText: before.consentText, noticeVersion: before.noticeVersion, channelOrder: before.channelOrder }, after: set },
        session
      );
    }
    return { saved: true };
  });
}
