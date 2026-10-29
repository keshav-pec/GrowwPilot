import { DateTime } from 'luxon';
import { Branch, Customer, OccasionCampaign, OfferIssue, Organization, User } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { logActivity } from '../../activity/activity.service.js';
import { CHANNEL_LABELS, PROMO_GAP_DAYS } from '../../../config/occasions.js';
import { assertCan } from '../permissions.js';
import { getOccasionSettings } from '../settings.service.js';
import { addOfferEvents } from '../engine/events.js';
import { campaignMessages, fillMessage, messageValues } from './templates.js';
import { checkSend, maskedDestination, sendLink } from './gate.js';
import { applyOutcome } from './contact.rules.js';

// Staff follow-up on one offer: send the ready-made message (from their own phone), record a call, assign.
// Everyone acts only on offers of customers whose home branch is one of their branches.

const GAP_MS = PROMO_GAP_DAYS * 24 * 60 * 60 * 1000;

async function offerToAct(ctx, id, session = null) {
  assertCan(ctx, 'occasions.followUp');
  const offer = await OfferIssue.findOne(scoped(ctx, { _id: id, homeBranchId: { $in: ctx.allowedBranchIds } })).session(session).lean();
  if (!offer) throw new AppError(404, 'NOT_FOUND', 'Offer not found');
  return offer;
}

// With both occasions in one month the birthday message goes first: true while the customer's birthday offer
// for the same month is still waiting to be contacted
async function birthdayFirst(ctx, offer, session = null) {
  if (offer.type !== 'ANNIVERSARY') return false;
  return Boolean(
    await OfferIssue.exists(
      scoped(ctx, { customerId: offer.customerId, type: 'BIRTHDAY', year: offer.year, month: offer.month, status: 'ISSUED', superseded: false, 'task.sentAt': null, 'task.state': 'OPEN' })
    ).session(session)
  );
}

// Everything needed to decide and build the message (for the preview; outside a transaction)
async function sendContext(ctx, offer) {
  const [customer, settings, org, campaign, branch] = await Promise.all([
    Customer.findOne(scoped(ctx, { _id: offer.customerId })).select('name phone email marketing').lean(),
    getOccasionSettings(ctx),
    Organization.findById(ctx.orgId).select('name contactPhone').lean(),
    OccasionCampaign.findOne(scoped(ctx, { _id: offer.campaignId })).select('type messages').lean(),
    Branch.findOne(scoped(ctx, { _id: offer.branchId })).select('timezone').lean(),
  ]);
  const gate = checkSend({ offer, customer, channelOrder: settings.channelOrder, birthdayFirst: await birthdayFirst(ctx, offer) });
  return { customer, settings, org, campaign, zone: branch?.timezone ?? 'Asia/Kolkata', gate };
}

function buildMessage({ offer, customer, org, campaign, zone }, channel) {
  const values = messageValues({ customerName: customer.name, salonName: org?.name, salonPhone: org?.contactPhone, rules: offer.rules, validUntil: offer.validUntil, zone });
  const wording = campaignMessages(campaign ?? { type: offer.type })[channel];
  return { subject: wording.subject ? fillMessage(wording.subject, values) : undefined, body: fillMessage(wording.body, values) };
}

// GET /api/occasions/offers/:id/send-preview?channel= — who it goes to, on which channel, and the finished message.
// When sending isn't allowed: the reason (no permission, contacted in the last 7 days, ...). Nothing is saved.
export async function sendPreview(ctx, id, { channel } = {}) {
  const offer = await offerToAct(ctx, id);
  const sc = await sendContext(ctx, offer);
  if (!sc.gate.allowed) return { allowed: false, code: sc.gate.code, reason: sc.gate.reason, nextAllowedAt: sc.gate.nextAllowedAt ?? null };
  const chosen = channel && sc.gate.channels.includes(channel) ? channel : sc.gate.channel;
  return { allowed: true, channels: sc.gate.channels, channel: chosen, to: maskedDestination(chosen, sc.customer), ...buildMessage({ offer, ...sc }, chosen) };
}

// POST /api/occasions/offers/:id/send — { channel }. Everything is checked again here. The 7-day slot is taken with
// one guarded update on the customer, so two desks pressing Send together count once. Returns the link that opens
// WhatsApp / SMS / email with the message filled in; the task is marked "Contacted via ...".
export async function sendOffer(ctx, id, { channel }, key) {
  try {
    return await runOnce(ctx, { key, operation: 'occasions.offer.send' }, async (session) => {
      const offer = await offerToAct(ctx, id, session);
      // One read at a time inside a transaction
      const customer = await Customer.findOne(scoped(ctx, { _id: offer.customerId })).select('name phone email marketing').session(session).lean();
      const settings = await getOccasionSettings(ctx, session);
      const org = await Organization.findById(ctx.orgId).select('name contactPhone').session(session).lean();
      const campaign = await OccasionCampaign.findOne(scoped(ctx, { _id: offer.campaignId })).select('type messages').session(session).lean();
      const branch = await Branch.findOne(scoped(ctx, { _id: offer.branchId })).select('timezone').session(session).lean();
      const now = new Date();
      const gate = checkSend({ offer, customer, channelOrder: settings.channelOrder, now, birthdayFirst: await birthdayFirst(ctx, offer, session) });
      if (!gate.allowed) {
        const when = gate.nextAllowedAt && DateTime.fromJSDate(gate.nextAllowedAt, { zone: branch?.timezone ?? 'Asia/Kolkata' }).toFormat('d LLL yyyy, h:mm a');
        throw new AppError(409, gate.code, when ? `${gate.reason} ${when}` : gate.reason, { nextAllowedAt: gate.nextAllowedAt });
      }
      if (!gate.channels.includes(channel)) throw new AppError(409, 'CHANNEL_NOT_ALLOWED', `${customer.name} hasn’t allowed offers on ${CHANNEL_LABELS[channel]}`);

      // Take the 7-day slot: only if permission is still there and no offer message went out in the last 7 days
      const slot = await Customer.updateOne(
        scoped(ctx, {
          _id: customer._id,
          [`marketing.${channel}.status`]: 'OPTED_IN',
          $or: [{ 'marketing.lastPromoAt': null }, { 'marketing.lastPromoAt': { $lte: new Date(now.getTime() - GAP_MS) } }],
        }),
        { $set: { 'marketing.lastPromoAt': now } },
        { session }
      );
      if (slot.modifiedCount !== 1) throw new AppError(409, 'SEND_REFUSED', 'Someone else just contacted this customer, or their permission changed. Please reload.');

      await OfferIssue.collection.updateOne(
        { _id: offer._id, status: 'ISSUED' },
        [
          {
            $set: {
              'task.sentAt': now,
              'task.contactedAt': { $ifNull: ['$task.contactedAt', now] },
              'task.outcome': `SENT_${channel}`,
              'task.state': { $cond: [{ $eq: ['$task.state', 'CLOSED'] }, 'CLOSED', 'CONTACTED'] },
            },
          },
        ],
        { session }
      );
      await addOfferEvents(ctx.orgId, [offer], 'SENT', { ctx, note: `via ${CHANNEL_LABELS[channel]}` }, session);
      await logActivity(ctx, { action: 'occasions.offer_sent', branchId: offer.homeBranchId, summary: `Sent ${customer.name} the ${offer.campaignName} offer via ${CHANNEL_LABELS[channel]}` }, session);

      const message = buildMessage({ offer, customer, org, campaign, zone: branch?.timezone ?? 'Asia/Kolkata' }, channel);
      return { channel, to: maskedDestination(channel, customer), ...message, link: sendLink(channel, customer, message) };
    });
  } catch (err) {
    // A refused send is written to the activity log (e.g. permission withdrawn between preview and confirm)
    if (err instanceof AppError && err.status === 409 && err.code !== 'IDEMPOTENCY_KEY_REUSED') {
      const offer = await OfferIssue.findOne(scoped(ctx, { _id: id })).select('customerName homeBranchId').lean();
      if (offer) await logActivity(ctx, { action: 'occasions.send_refused', branchId: offer.homeBranchId, summary: `Sending ${offer.customerName}’s offer was refused: ${err.message}` });
    }
    throw err;
  }
}

// POST /api/occasions/offers/:id/contact — { outcome, note?, callbackAt? }
export async function recordContact(ctx, id, input, key) {
  return runOnce(ctx, { key, operation: 'occasions.offer.contact' }, async (session) => {
    const offer = await offerToAct(ctx, id, session);
    const withdrawnNotice = offer.status === 'REVOKED' && offer.task?.kind === 'WITHDRAWN_NOTICE' && offer.task.state === 'OPEN';
    if (offer.status !== 'ISSUED' && !withdrawnNotice) throw new AppError(409, 'OFFER_CLOSED', 'This offer is no longer running');
    const branch = await Branch.findOne(scoped(ctx, { _id: offer.branchId })).select('timezone').session(session).lean();
    const refuse = (code, message) => {
      throw new AppError(400, code, message);
    };
    const result = applyOutcome(offer.task ?? {}, input, { now: new Date(), zone: branch?.timezone ?? 'Asia/Kolkata', validUntil: offer.validUntil, refuse });
    const saved = await OfferIssue.updateOne({ _id: offer._id, status: offer.status, 'task.attempts': offer.task?.attempts ?? 0 }, { $set: result.set }, { session });
    if (saved.modifiedCount !== 1) throw new AppError(409, 'OFFER_CHANGED', 'Someone else just updated this offer. Please reload.');
    const note = input.note ? `${result.note}. ${input.note}` : result.note;
    await addOfferEvents(ctx.orgId, [offer], 'CONTACT', { ctx, note }, session);
    await logActivity(ctx, { action: 'occasions.call_recorded', branchId: offer.homeBranchId, summary: `Call with ${offer.customerName} about the ${offer.campaignName} offer: ${result.note}` }, session);
    return { outcome: input.outcome, fixDetails: Boolean(result.fixDetails) };
  });
}

// The people an offer can be assigned to: front desk of the customer's home branch, and owners of it
async function assignable(ctx, branchId, session = null) {
  return User.find(
    scoped(ctx, {
      status: 'active',
      $or: [{ role: 'FRONT_DESK', branchIds: branchId }, { role: 'OWNER', allBranches: true }, { role: 'OWNER', branchIds: branchId }],
    })
  )
    .select('name role allBranches')
    .sort({ name: 1 })
    .session(session)
    .lean();
}

// GET /api/occasions/offers/:id/assignees
export async function listAssignees(ctx, id) {
  const offer = await offerToAct(ctx, id);
  const users = await assignable(ctx, offer.homeBranchId);
  return { assignees: users.map((u) => ({ _id: u._id, name: u.name, role: u.role === 'FRONT_DESK' ? 'Front desk' : u.allBranches ? 'Business owner' : 'Branch owner' })) };
}

// POST /api/occasions/offers/:id/assign — { assigneeId } (null = anyone at the branch). The history is kept.
export async function assignOffer(ctx, id, { assigneeId }, key) {
  return runOnce(ctx, { key, operation: 'occasions.offer.assign' }, async (session) => {
    const offer = await offerToAct(ctx, id, session);
    if (!['ISSUED', 'REVOKED'].includes(offer.status)) throw new AppError(409, 'OFFER_CLOSED', 'This offer is no longer running');
    let name = 'anyone at the branch';
    if (assigneeId) {
      const user = (await assignable(ctx, offer.homeBranchId, session)).find((u) => String(u._id) === String(assigneeId));
      if (!user) throw new AppError(400, 'INVALID_ASSIGNEE', 'Choose someone who works at the customer’s branch');
      name = user.name;
    }
    await OfferIssue.updateOne({ _id: offer._id }, { $set: { 'task.assigneeId': assigneeId ?? null } }, { session });
    await addOfferEvents(ctx.orgId, [offer], 'ASSIGNED', { ctx, note: `Assigned to ${name}` }, session);
    await logActivity(ctx, { action: 'occasions.offer_assigned', branchId: offer.homeBranchId, summary: `Assigned ${offer.customerName}’s ${offer.campaignName} follow-up to ${name}` }, session);
    return { assigneeId: assigneeId ?? null };
  });
}
