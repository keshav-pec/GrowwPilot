import { Branch, ConsentEvent, Customer, Organization, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { runOnce } from '../../middleware/idempotency.js';
import { actorRole, logActivity } from '../activity/activity.service.js';
import { CHANNEL_LABELS, CONSENT_CHANNELS, describeOccasionDate } from '../../config/occasions.js';
import { assertCan, can } from './permissions.js';
import { consentWording, getOccasionSettings } from './settings.service.js';

// ---------------------------------------------------------------------------
// Birthday, anniversary and home branch
// ---------------------------------------------------------------------------
const OCCASION_WORDS = { birthday: 'birthday', anniversary: 'anniversary' };
const sameDate = (a, b) => (a?.month ?? null) === (b?.month ?? null) && (a?.day ?? null) === (b?.day ?? null);

// What to save for the dates that were sent and actually changed. input: { birthday?, anniversary? },
// each { month, day? } or null (cleared). A cleared date is saved as null, never removed, so the start-up
// migration knows not to copy the old date of birth back.
export function occasionDateChanges(customer, input, { source, userId, now = new Date() }) {
  const set = {};
  const words = [];
  for (const field of Object.keys(OCCASION_WORDS)) {
    if (input[field] === undefined) continue;
    const before = customer.occasions?.[field] ?? null;
    const after = input[field];
    if (sameDate(before, after)) continue;
    set[`occasions.${field}`] = after ? { month: after.month, day: after.day ?? null, source, updatedAt: now, updatedBy: userId } : null;
    words.push(after ? `${OCCASION_WORDS[field]} ${describeOccasionDate(after)}` : `${OCCASION_WORDS[field]} cleared`);
  }
  return { set, words };
}

// A home branch must be an active branch this user works at (the business owner: any active branch)
export async function resolveHomeBranch(ctx, branchId, session = null) {
  if (!ctx.allowedBranchIds.includes(String(branchId))) throw new AppError(400, 'INVALID_BRANCH', 'Choose one of your branches');
  const branch = await Branch.findOne(scoped(ctx, { _id: branchId, status: 'active' })).select('name').session(session).lean();
  if (!branch) throw new AppError(400, 'INVALID_BRANCH', 'Choose one of your branches');
  return branch;
}

// Everything the customer form or the dates route changed, with the words for the activity log
export async function customerOccasionChanges(ctx, customer, input, session = null) {
  const { set, words } = occasionDateChanges(customer, input, { source: 'STAFF', userId: ctx.userId });
  if (words.length > 0) assertCan(ctx, 'occasions.editDates');
  if (input.homeBranchId !== undefined && String(input.homeBranchId) !== String(customer.homeBranchId ?? '')) {
    assertCan(ctx, 'occasions.editHomeBranch');
    const branch = await resolveHomeBranch(ctx, input.homeBranchId, session);
    set.homeBranchId = branch._id;
    words.push(`home branch ${branch.name}`);
  }
  return { set, words };
}

// The activity row for a change to one customer's occasion details (shown to the owners of their home branch)
export function logCustomerChange(ctx, customer, { action, summary, before, after }, session) {
  return logActivity(ctx, { action, branchId: customer.homeBranchId ?? null, summary, before, after }, session);
}

// PUT /api/occasions/customers/:id/dates — { birthday?, anniversary?, homeBranchId? }
export async function setCustomerDates(ctx, id, input, key) {
  assertCan(ctx, 'occasions.editDates');
  return runOnce(ctx, { key, operation: 'occasions.customer.dates' }, async (session) => {
    const customer = await Customer.findOne(scoped(ctx, { _id: id })).session(session).lean();
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
    const { set, words } = await customerOccasionChanges(ctx, customer, input, session);
    if (words.length > 0) {
      await Customer.updateOne(scoped(ctx, { _id: id }), { $set: set }, { session });
      await logCustomerChange(
        ctx,
        { ...customer, homeBranchId: set.homeBranchId ?? customer.homeBranchId },
        { action: 'occasions.dates_changed', summary: `Changed ${customer.name}’s details: ${words.join('; ')}`, before: { occasions: customer.occasions, homeBranchId: customer.homeBranchId }, after: set },
        session
      );
    }
    const saved = await Customer.findOne(scoped(ctx, { _id: id })).select('occasions homeBranchId').session(session).lean();
    return { customer: saved, changed: words.length > 0 };
  });
}

// ---------------------------------------------------------------------------
// Messaging permission
// ---------------------------------------------------------------------------
const statusOf = (customer, channel) => customer.marketing?.[channel]?.status ?? 'UNKNOWN';

// The Messages & permission tab: each channel's status, the consent sentence for each channel, and what this user may do
export async function getConsents(ctx, id) {
  assertCan(ctx, 'occasions.viewConsent');
  const customer = await Customer.findOne(scoped(ctx, { _id: id })).select('name email marketing').lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const [settings, org] = await Promise.all([getOccasionSettings(ctx), Organization.findById(ctx.orgId).select('name').lean()]);
  const userIds = CONSENT_CHANNELS.map((c) => customer.marketing?.[c]?.changedBy).filter(Boolean);
  const users = userIds.length ? await User.find(scoped(ctx, { _id: { $in: userIds } })).select('name').lean() : [];
  const nameOf = Object.fromEntries(users.map((u) => [String(u._id), u.name]));

  return {
    channels: CONSENT_CHANNELS.map((channel) => {
      const c = customer.marketing?.[channel] ?? {};
      return {
        channel,
        status: c.status ?? 'UNKNOWN',
        source: c.source ?? null,
        noticeVersion: c.noticeVersion ?? null,
        evidence: c.evidence ?? null,
        changedAt: c.changedAt ?? null,
        changedByName: c.changedBy ? (nameOf[String(c.changedBy)] ?? null) : null,
        // Email permission needs an email address
        available: channel !== 'EMAIL' || Boolean(customer.email),
      };
    }),
    wording: Object.fromEntries(CONSENT_CHANNELS.map((channel) => [channel, consentWording(settings.consentText, org?.name, channel)])),
    noticeVersion: settings.noticeVersion,
    can: {
      record: can(ctx, 'occasions.recordConsent'),
      withdraw: can(ctx, 'occasions.withdrawConsent'),
      removeData: can(ctx, 'occasions.removeData'),
      mustConfirmCustomerAsked: ctx.role === 'FRONT_DESK',
    },
  };
}

// Saves one channel's new status with its history row. Only if nobody changed it in the meantime.
async function changeConsent(ctx, customer, channel, to, { source, noticeVersion, wording, customerAsked, note }, session) {
  const from = statusOf(customer, channel);
  const now = new Date();
  const path = `marketing.${channel}`;
  const changed = await Customer.updateOne(
    scoped(ctx, { _id: customer._id, [`${path}.status`]: { $in: from === 'UNKNOWN' ? ['UNKNOWN', null] : [from] } }),
    { $set: { [path]: { status: to, source, noticeVersion: noticeVersion ?? null, evidence: note || null, changedAt: now, changedBy: ctx.userId } } },
    { session }
  );
  if (changed.modifiedCount !== 1) {
    throw new AppError(409, 'CONSENT_CHANGED', 'This permission was changed a moment ago. Please reload and try again.');
  }
  await ConsentEvent.create(
    [{ orgId: ctx.orgId, customerId: customer._id, channel, from, to, source, noticeVersion, wording, customerAsked: Boolean(customerAsked), note: note || undefined, actorId: ctx.userId, actorName: ctx.userName, actorRole: actorRole(ctx) }],
    { session }
  );
  return { from, to };
}

// POST /api/occasions/customers/:id/consents — record (OPTED_IN) or withdraw (OPTED_OUT) one channel.
// Recording needs the tick box, how it was given, and from the front desk "Customer asked for this".
// Withdrawing works straight away.
export async function recordConsent(ctx, id, input, key) {
  const optingIn = input.status === 'OPTED_IN';
  assertCan(ctx, optingIn ? 'occasions.recordConsent' : 'occasions.withdrawConsent');
  if (optingIn && !input.agreed) throw new AppError(400, 'CONSENT_NOT_CONFIRMED', 'Tick the box to confirm the customer agreed to the wording');
  if (optingIn && ctx.role === 'FRONT_DESK' && !input.customerAsked) {
    throw new AppError(400, 'CUSTOMER_ASK_REQUIRED', 'Tick “Customer asked for this” to record permission');
  }

  return runOnce(ctx, { key, operation: 'occasions.consent.change' }, async (session) => {
    const customer = await Customer.findOne(scoped(ctx, { _id: id })).session(session).lean();
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
    const label = CHANNEL_LABELS[input.channel];
    if (statusOf(customer, input.channel) === input.status) {
      throw new AppError(409, 'CONSENT_UNCHANGED', `${customer.name} is already ${optingIn ? 'opted in to' : 'opted out of'} ${label}`);
    }
    if (optingIn && input.channel === 'EMAIL' && !customer.email) {
      throw new AppError(400, 'NO_EMAIL', 'Add the customer’s email address first');
    }

    let noticeVersion = null;
    let wording = null;
    if (optingIn) {
      const settings = await getOccasionSettings(ctx, session);
      const org = await Organization.findById(ctx.orgId).select('name').session(session).lean();
      noticeVersion = settings.noticeVersion;
      wording = consentWording(settings.consentText, org?.name, input.channel);
    }
    await changeConsent(ctx, customer, input.channel, input.status, { ...input, noticeVersion, wording }, session);
    await logCustomerChange(
      ctx,
      customer,
      {
        action: optingIn ? 'occasions.consent_recorded' : 'occasions.consent_withdrawn',
        summary: optingIn ? `Recorded ${customer.name}’s permission for ${label} offers (wording ${noticeVersion})` : `${customer.name} opted out of ${label} offers`,
      },
      session
    );
    return { channel: input.channel, status: input.status };
  });
}

// GET /api/occasions/customers/:id/consents/history — every change, newest first
export async function consentHistory(ctx, id) {
  assertCan(ctx, 'occasions.viewConsent');
  const exists = await Customer.exists(scoped(ctx, { _id: id }));
  if (!exists) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const events = await ConsentEvent.find(scoped(ctx, { customerId: id })).sort({ createdAt: -1, _id: -1 }).limit(200).lean();
  return { events };
}

// ---------------------------------------------------------------------------
// Remove occasion data (business owner): clears the dates (and the old date of birth) and opts the customer
// out of every channel, with a reason. The stand-in for an erasure request until the app has a privacy workflow.
// ---------------------------------------------------------------------------
export async function removeOccasionData(ctx, id, { reason }, key) {
  assertCan(ctx, 'occasions.removeData');
  return runOnce(ctx, { key, operation: 'occasions.customer.remove_data' }, async (session) => {
    const customer = await Customer.findOne(scoped(ctx, { _id: id })).session(session).lean();
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');

    await Customer.updateOne(scoped(ctx, { _id: id }), { $set: { 'occasions.birthday': null, 'occasions.anniversary': null }, $unset: { dob: '' } }, { session });
    for (const channel of CONSENT_CHANNELS) {
      if (statusOf(customer, channel) === 'OPTED_OUT') continue;
      await changeConsent(ctx, customer, channel, 'OPTED_OUT', { source: 'DATA_REMOVAL', note: reason }, session);
    }
    await logCustomerChange(
      ctx,
      customer,
      { action: 'occasions.data_removed', summary: `Removed ${customer.name}’s occasion data and opted them out of all messages. Reason: ${reason}`, before: { occasions: customer.occasions } },
      session
    );
    return { removed: true };
  });
}
