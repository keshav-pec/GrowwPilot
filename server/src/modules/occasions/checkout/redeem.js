import { OfferIssue } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { logActivity } from '../../activity/activity.service.js';
import { formatMoney } from '../../../utils/money.js';
import { addOfferEvents } from '../engine/events.js';

// Using and giving back an offer, inside the bill's own transaction (called from invoices.service.js).

// The bill is being issued: the offer is used now. One guarded update, so two desks can never use the same
// offer: whoever issues second gets OFFER_TAKEN and their whole issue is rolled back (nothing is used).
export async function redeemOffer(ctx, invoice, offer, session) {
  const now = new Date();
  const used = await OfferIssue.findOneAndUpdate(
    { _id: offer.offerIssueId, orgId: ctx.orgId, customerId: invoice.customerId, status: 'ISSUED', validUntil: { $gt: now } },
    { $set: { status: 'REDEEMED', invoiceId: invoice._id, discountGiven: offer.discount } },
    { session, returnDocument: 'after' }
  ).lean();
  if (!used) throw new AppError(409, 'OFFER_TAKEN', 'Offer was redeemed elsewhere. Invoice refreshed; please review payable.');
  // Its follow-up is done (a task already closed keeps its own reason)
  await OfferIssue.updateOne({ _id: used._id, 'task.state': { $ne: 'CLOSED' } }, { $set: { 'task.state': 'CLOSED', 'task.closedReason': 'REDEEMED', 'task.closedAt': now } }, { session });
  await addOfferEvents(ctx.orgId, [used], 'REDEEMED', { ctx, note: `Bill ${invoice.invoiceNumber}: ${formatMoney(offer.discount)} off` }, session);
  await logActivity(
    ctx,
    { action: 'occasions.offer_redeemed', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Used ${invoice.customerSnapshot?.name}’s ${used.campaignName} offer on bill ${invoice.invoiceNumber}: ${formatMoney(offer.discount)} off` },
    session
  );
}

// The bill is voided: an offer used on it becomes usable again if its month isn't over (exactly once: the bill
// can only be voided once); after the month it stays expired. Refunds never give an offer back.
export async function restoreOffer(ctx, invoice, session) {
  if (!invoice.offer?.offerIssueId) return null;
  const now = new Date();
  const offer = await OfferIssue.findOne({ _id: invoice.offer.offerIssueId, orgId: ctx.orgId, status: 'REDEEMED', invoiceId: invoice._id }).session(session).lean();
  if (!offer) return null;
  const stillRunning = offer.validUntil > now;
  const set = stillRunning ? { status: 'ISSUED', invoiceId: null, discountGiven: null } : { status: 'EXPIRED', invoiceId: null, discountGiven: null };
  if (offer.task?.closedReason === 'REDEEMED') {
    Object.assign(set, stillRunning ? { 'task.state': offer.task.contactedAt ? 'CONTACTED' : 'OPEN', 'task.closedReason': null, 'task.closedAt': null } : { 'task.closedReason': 'EXPIRED' });
  }
  await OfferIssue.updateOne({ _id: offer._id, status: 'REDEEMED', invoiceId: invoice._id }, { $set: set }, { session });
  await addOfferEvents(ctx.orgId, [offer], stillRunning ? 'RESTORED' : 'EXPIRED', { ctx, note: `Bill ${invoice.invoiceNumber} was voided${stillRunning ? '' : ' after the offer’s month ended'}` }, session);
  await logActivity(
    ctx,
    { action: 'occasions.offer_restored', branchId: invoice.branchId, invoiceId: invoice._id, summary: stillRunning ? `${invoice.customerSnapshot?.name}’s ${offer.campaignName} offer can be used again (bill ${invoice.invoiceNumber} voided)` : `${invoice.customerSnapshot?.name}’s ${offer.campaignName} offer stays expired (bill ${invoice.invoiceNumber} voided after its month)` },
    session
  );
  return stillRunning ? 'RESTORED' : 'EXPIRED';
}
