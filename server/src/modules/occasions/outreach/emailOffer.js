import mongoose from 'mongoose';
import { Customer, OfferIssue, User } from '../../../models/index.js';
import { escapeHtml, layout, textToHtml } from '../../mail/html.js';
import { onBeforeSend, onResult } from '../../mail/outbox.js';
import { logActivity } from '../../activity/activity.service.js';
import { notify } from '../../notifications/notifications.service.js';
import { addOfferEvents } from '../engine/events.js';
import { campaignMessages, fillMessage, messageValues } from './templates.js';
import { maskedDestination } from './gate.js';
import { unsubscribeUrl } from './unsubscribe.js';

// Offer emails sent by the app. WhatsApp and SMS are still sent by staff from their phone.

// What goes in the outbox for an offer email (the caller adds its own dedupeKey)
export const offerEmailFields = ({ offer, customer, org, email }) => ({
  kind: 'OCCASION_OFFER',
  branchId: offer.homeBranchId,
  to: customer.email,
  subject: email.subject,
  text: email.text,
  html: email.html,
  headers: email.headers,
  fromName: org.name,
  replyTo: org.contactEmail,
  ref: { offerId: offer._id },
});

// The campaign's EMAIL wording, filled in, as an email: plain text and HTML, with the salon's details, why the
// customer gets it, and the unsubscribe link (always added, even with custom wording)
export function buildOfferEmail({ offer, customer, org, campaign, zone }) {
  const values = messageValues({ customerName: customer.name, salonName: org?.name, salonPhone: org?.contactPhone, rules: offer.rules, validUntil: offer.validUntil, zone });
  const wording = campaignMessages(campaign ?? { type: offer.type }).EMAIL;
  const subject = fillMessage(wording.subject, values);
  const body = fillMessage(wording.body, values);
  const url = unsubscribeUrl(offer.orgId, customer._id);
  const salon = org?.name ?? 'the salon';
  const contact = org?.contactPhone ? `${salon} · ${org.contactPhone}` : salon;
  const why = `You’re getting this because you agreed to receive offers from ${salon} by email.`;

  return {
    subject,
    body,
    text: `${body}\n\n--\n${contact}\n${why}\nUnsubscribe: ${url}`,
    html: layout({
      salonName: salon,
      body: textToHtml(body),
      footer: `${escapeHtml(contact)}<br>${escapeHtml(why)}<br><a href="${escapeHtml(url)}" style="color:#6b4226;">Unsubscribe</a>`,
    }),
    // Gmail's own "Unsubscribe" button (SMTP only: Apps Script can't set headers; the footer link covers it)
    headers: { 'List-Unsubscribe': `<${url}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  };
}

// Just before the mailer sends: is it still all right to send?
async function checkBeforeSending(row) {
  const offer = await OfferIssue.findOne({ _id: row.ref?.offerId, orgId: row.orgId }).select('status validUntil customerId').lean();
  if (!offer || offer.status !== 'ISSUED' || offer.validUntil < new Date()) return { skip: true, reason: 'The offer is no longer running.' };
  const customer = await Customer.findOne({ _id: offer.customerId, orgId: row.orgId }).select('email marketing').lean();
  if (customer?.marketing?.EMAIL?.status !== 'OPTED_IN') return { skip: true, reason: 'The customer no longer allows offer emails.' };
  if (String(customer.email ?? '').trim().toLowerCase() !== row.to) return { skip: true, reason: 'The customer’s email address was changed. Send it again.' };
  return null;
}

// After the mailer is done with it: Sent, or Failed / Skipped (the 7-day slot is given back and the task reopens)
async function offerEmailResult(row) {
  if (!row.ref?.offerId) return;
  await mongoose.connection.transaction(async (session) => {
    // Only the latest send of this offer counts (a newer one may have replaced it)
    const offer = await OfferIssue.findOne({ _id: row.ref.offerId, orgId: row.orgId, 'task.emailOutboxId': row._id, 'task.emailStatus': 'QUEUED' }).session(session).lean();
    if (!offer) return;
    const mine = { _id: offer._id, 'task.emailOutboxId': row._id };

    if (row.status === 'SENT') {
      await OfferIssue.updateOne(mine, { $set: { 'task.emailStatus': 'SENT', 'task.emailError': null } }, { session });
      await addOfferEvents(row.orgId, [offer], 'EMAIL_SENT', { note: `Email sent to ${maskedDestination('EMAIL', { email: row.to })}`, outcome: 'EMAIL' }, session);
      return;
    }

    const reason = row.lastError || 'The email couldn’t be sent.';
    const sentAt = offer.task?.sentAt;
    // Undo "contacted via email" (unless the customer was reached another way first)
    await OfferIssue.collection.updateOne(
      mine,
      [
        {
          $set: {
            'task.emailStatus': 'FAILED',
            'task.emailError': reason,
            'task.state': { $cond: [{ $and: [{ $eq: ['$task.state', 'CONTACTED'] }, { $eq: ['$task.contactedAt', '$task.sentAt'] }] }, 'OPEN', '$task.state'] },
            'task.contactedAt': { $cond: [{ $eq: ['$task.contactedAt', '$task.sentAt'] }, null, '$task.contactedAt'] },
            'task.outcome': { $cond: [{ $eq: ['$task.outcome', 'SENT_EMAIL'] }, null, '$task.outcome'] },
            'task.sentAt': null,
            'task.sentVia': null,
            'task.sentAutomatically': false, // back on the staff list: never emailed automatically again
          },
        },
      ],
      { session }
    );
    // Give the 7-day slot back, if this send is still the last offer message the customer got
    if (sentAt) await Customer.updateOne({ _id: offer.customerId, orgId: row.orgId, 'marketing.lastPromoAt': sentAt }, { $set: { 'marketing.lastPromoAt': null } }, { session });
    await addOfferEvents(row.orgId, [offer], 'EMAIL_FAILED', { note: reason, outcome: 'EMAIL' }, session);

    // The bell and the activity log, for the person who pressed Send
    const sender = row.createdBy?.id ? await User.findOne({ _id: row.createdBy.id, orgId: row.orgId }).select('name role allBranches').session(session).lean() : null;
    await notify({ orgId: String(row.orgId), userId: null }, sender ? [sender._id] : [], { message: `The offer email to ${offer.customerName} wasn’t sent. ${reason} You can send it again.`, link: `/app/occasions?offer=${offer._id}` }, session);
    if (sender) {
      const ctx = { orgId: String(row.orgId), userId: String(sender._id), userName: sender.name, role: sender.role, isPrimaryOwner: sender.role === 'OWNER' && sender.allBranches };
      await logActivity(ctx, { action: 'occasions.email_failed', branchId: offer.homeBranchId, summary: `The offer email to ${offer.customerName} wasn’t sent: ${reason}` }, session);
    }
  });
}

onBeforeSend('OCCASION_OFFER', checkBeforeSending);
onResult('OCCASION_OFFER', offerEmailResult);
