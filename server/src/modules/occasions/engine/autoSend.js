import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Customer, EmailOutbox, OccasionCampaign, OfferIssue, Organization } from '../../../models/index.js';
import { AUTO_EMAIL_DEFAULTS, PROMO_GAP_DAYS } from '../../../config/occasions.js';
import { mailMode, mailSettings } from '../../mail/config.js';
import { kickMailer, queueEmail, sentLast24h } from '../../mail/outbox.js';
import { buildOfferEmail } from '../outreach/emailOffer.js';
import { checkSend } from '../outreach/gate.js';
import { birthdayFirst } from '../outreach/followup.service.js';
import { addOfferEvents } from './events.js';

// Automatic offer emails (EMAIL_PLAN.md Part 3), run in the offer engine's tick for one branch (under its lock).
// For campaigns set to "Send automatically by email":
//   - offers given this month, not messaged yet, task still open, whose customer allows email
//   - only inside the salon's send hours, in the branch's time zone
//   - the same send check as staff (permission, a valid email, 7 days since the last offer message, birthday first)
//   - the 7-day slot is taken with the same guarded update, so a staff member and the app never both send
//   - at most the salon's daily limit (and what is left of the platform's); the rest go on the next day
// Customers who allow only WhatsApp or SMS stay on the staff list. An email that fails goes back to the staff list
// and is never tried automatically again.

const DAY_MS = 24 * 60 * 60 * 1000;
const GAP_MS = PROMO_GAP_DAYS * DAY_MS;
export const AUTO_PRIORITY = 5; // after password, test, bill and staff-sent emails

// "10:00" <= branch time < "19:00"
export function insideSendHours(now, zone, { sendFrom, sendUntil }) {
  const time = DateTime.fromJSDate(now, { zone }).toFormat('HH:mm');
  return time >= sendFrom && time < sendUntil;
}

// The salon's campaigns that email automatically, or [] (also [] when email can't be sent at all)
export async function autoEmailCampaignIds(orgId) {
  if (mailMode() === 'off') return [];
  return OccasionCampaign.find({ orgId, deliveryMode: 'AUTO_EMAIL', status: 'PUBLISHED' }).distinct('_id');
}

// How many more automatic emails may be queued now: the salon's limit and the platform's, over the last 24 hours
async function roomLeft(orgId, dailyLimit, now) {
  const since = new Date(now.getTime() - DAY_MS);
  const [salonUsed, platformSent, platformWaiting] = await Promise.all([
    EmailOutbox.countDocuments({ orgId, kind: 'OCCASION_OFFER', priority: AUTO_PRIORITY, createdAt: { $gte: since }, status: { $in: ['PENDING', 'SENDING', 'SENT'] } }),
    sentLast24h(),
    EmailOutbox.countDocuments({ status: { $in: ['PENDING', 'SENDING'] } }),
  ]);
  return Math.max(0, Math.min(dailyLimit - salonUsed, mailSettings().dailyLimit - platformSent - platformWaiting));
}

// Returns { queued }
export async function autoSendForBranch(orgId, branch, { now = new Date(), settings, campaignIds }) {
  const auto = { ...AUTO_EMAIL_DEFAULTS, ...settings?.autoEmail };
  if (!campaignIds?.length || !insideSendHours(now, branch.timezone, auto)) return { queued: 0 };
  let room = await roomLeft(orgId, auto.dailyLimit, now);
  if (room === 0) return { queued: 0 };

  // Birthdays first (they go before an anniversary in the same month), oldest offers first
  const candidates = await OfferIssue.find({
    orgId,
    homeBranchId: branch._id,
    campaignId: { $in: campaignIds },
    status: 'ISSUED',
    superseded: false,
    validUntil: { $gte: now },
    channels: 'EMAIL',
    'task.kind': 'CONTACT',
    'task.state': 'OPEN',
    'task.sentAt': null,
    'task.emailStatus': null, // never emailed (a failed email stays with the staff)
  })
    .sort({ type: -1, issuedAt: 1, _id: 1 })
    .limit(room * 2) // some may be refused by the send check
    .lean();

  const ctx = { orgId: String(orgId), userId: null, userName: 'Automatic', role: 'SYSTEM', isPrimaryOwner: false, allowedBranchIds: [String(branch._id)] };
  const org = await Organization.findById(orgId).select('name contactPhone contactEmail').lean();
  const campaigns = new Map((await OccasionCampaign.find({ _id: { $in: campaignIds } }).select('type messages').lean()).map((c) => [String(c._id), c]));
  let queued = 0;
  for (const offer of candidates) {
    if (room === 0) break;
    const sent = await sendOne(ctx, { offer, org, campaign: campaigns.get(String(offer.campaignId)), branch, settings, now });
    if (sent) {
      queued += 1;
      room -= 1;
    }
  }
  if (queued > 0) kickMailer();
  return { queued };
}

// One offer, in its own transaction. Returns true when its email was queued.
async function sendOne(ctx, { offer, org, campaign, branch, settings, now }) {
  try {
    return await mongoose.connection.transaction(async (session) => {
      const customer = await Customer.findOne({ _id: offer.customerId, orgId: offer.orgId }).select('name phone email marketing').session(session).lean();
      if (!customer) return false;
      const gate = checkSend({ offer, customer, channelOrder: settings?.channelOrder ?? ['WHATSAPP', 'SMS', 'EMAIL'], now, birthdayFirst: await birthdayFirst(ctx, offer, session) });
      if (!gate.allowed || !gate.channels.includes('EMAIL')) return false;

      const slot = await Customer.updateOne(
        {
          _id: customer._id,
          orgId: offer.orgId,
          'marketing.EMAIL.status': 'OPTED_IN',
          $or: [{ 'marketing.lastPromoAt': null }, { 'marketing.lastPromoAt': { $lte: new Date(now.getTime() - GAP_MS) } }],
        },
        { $set: { 'marketing.lastPromoAt': now } },
        { session }
      );
      if (slot.modifiedCount !== 1) return false; // a staff member got there first

      const email = buildOfferEmail({ offer, customer, org, campaign, zone: branch.timezone });
      const row = await queueEmail(
        ctx,
        {
          kind: 'OCCASION_OFFER',
          priority: AUTO_PRIORITY,
          dedupeKey: `offer:${offer._id}:auto`, // one automatic email per offer, ever
          branchId: offer.homeBranchId,
          to: customer.email,
          subject: email.subject,
          text: email.text,
          html: email.html,
          headers: email.headers,
          fromName: org.name,
          replyTo: org.contactEmail,
          ref: { offerId: offer._id },
        },
        session
      );
      const marked = await OfferIssue.updateOne(
        { _id: offer._id, status: 'ISSUED', 'task.state': 'OPEN', 'task.sentAt': null },
        {
          $set: {
            'task.state': 'CONTACTED',
            'task.contactedAt': now,
            'task.sentAt': now,
            'task.sentVia': 'EMAIL',
            'task.outcome': 'SENT_EMAIL',
            'task.sentAutomatically': true,
            'task.emailOutboxId': row.id,
            'task.emailStatus': 'QUEUED',
            'task.emailError': null,
          },
        },
        { session }
      );
      if (marked.modifiedCount !== 1) throw new Error('offer changed'); // undo the slot and the email
      await addOfferEvents(offer.orgId, [offer], 'SENT', { ctx, note: 'Emailed automatically', outcome: 'EMAIL' }, session);
      return true;
    });
  } catch (err) {
    if (err.message !== 'offer changed') console.error(`Occasion offers: automatic email for offer ${offer._id} failed:`, err);
    return false;
  }
}
