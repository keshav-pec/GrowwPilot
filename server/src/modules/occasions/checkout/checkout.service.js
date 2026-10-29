import mongoose from 'mongoose';
import { Appointment, Branch, Customer, Invoice, OfferIssue, Service } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { formatMoney } from '../../../utils/money.js';
import { logActivity } from '../../activity/activity.service.js';
import { occasionDiscount } from '../../billing/tax.rules.js';
import { loadInvoice, occasionEligible, present, priceDraft } from '../../invoices/invoices.service.js';
import { describeOffer } from '../campaigns/campaign.rules.js';
import { addOfferEvents } from '../engine/events.js';

// Occasion offers at checkout and on bookings (OCCASION_OFFERS_PLAN.md, Phase 5).
// One offer per bill; it applies only to the eligible service lines, doesn't mix with other discounts, and is
// used up only when the bill is issued (invoices.service.js -> redeem.js).

const LABEL = { BIRTHDAY: 'Birthday', ANNIVERSARY: 'Anniversary' };
const day = (date, zone) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: zone }).format(date);

// Why an offer can't go on this bill, in the words the desk sees
function notEligibleWords(result) {
  if (result.code === 'MIN_SPEND') return `Add ${formatMoney(result.shortBy)} of eligible services to qualify for this offer`;
  if (result.code === 'NO_ELIGIBLE_SERVICE') return 'No eligible service on this bill';
  return null;
}

// What the bill would come to with this offer (worked out by the server; nothing saved)
async function withOffer(ctx, invoice, offer) {
  const { fields } = await priceDraft(ctx, { ...invoice, offer: { offerIssueId: offer._id, type: offer.type, campaignName: offer.campaignName, rules: offer.rules } });
  return fields;
}

// GET /api/invoices/:id/occasion-offers — the customer's offers for this draft: which can be applied (with the
// eligible subtotal, the discount and the new payable) and why the others can't
export async function offersForInvoice(ctx, invoiceId) {
  const invoice = await loadInvoice(ctx, invoiceId);
  if (!invoice.customerId) return { applied: null, offers: [] };
  const now = new Date();
  const thisYear = now.getUTCFullYear();
  const [offers, appointment] = await Promise.all([
    OfferIssue.find(scoped(ctx, { customerId: invoice.customerId, superseded: false, year: { $gte: thisYear - 1 }, status: { $in: ['ISSUED', 'REDEEMED', 'EXPIRED'] } })).sort({ validUntil: -1 }).lean(),
    invoice.appointmentId ? Appointment.findOne(scoped(ctx, { _id: invoice.appointmentId })).select('offerIssueId').lean() : null,
  ]);
  const branches = new Map((await Branch.find(scoped(ctx)).select('name timezone').lean()).map((b) => [String(b._id), b]));
  const zone = branches.get(String(invoice.branchId))?.timezone ?? 'Asia/Kolkata';
  const usedOn = await Invoice.find(scoped(ctx, { _id: { $in: offers.map((o) => o.invoiceId).filter(Boolean) } })).select('invoiceNumber branchId issuedAt').lean();
  const manual = (invoice.manualDiscount ?? 0) > 0;

  const rows = [];
  for (const offer of offers) {
    const base = {
      _id: offer._id,
      type: offer.type,
      label: `${LABEL[offer.type]} offer`,
      campaignName: offer.campaignName,
      offerSummary: describeOffer(offer.rules),
      validUntil: offer.validUntil,
      status: offer.status,
      linked: String(appointment?.offerIssueId ?? '') === String(offer._id),
      applied: String(invoice.offer?.offerIssueId ?? '') === String(offer._id),
    };
    if (offer.status === 'REDEEMED') {
      if (String(offer.invoiceId) === String(invoice._id)) continue;
      const bill = usedOn.find((b) => String(b._id) === String(offer.invoiceId));
      rows.push({ ...base, canApply: false, code: 'REDEEMED', reason: bill ? `Offer redeemed on invoice ${bill.invoiceNumber} at ${branches.get(String(bill.branchId))?.name ?? 'another branch'}, ${day(bill.issuedAt, zone)}` : 'Offer already redeemed' });
      continue;
    }
    if (offer.status === 'EXPIRED' || offer.validUntil <= now) {
      // Only last month's and this year's recent ones are worth showing
      if (now - offer.validUntil > 45 * 24 * 3600 * 1000) continue;
      rows.push({ ...base, canApply: false, code: 'EXPIRED', reason: `This occasion offer expired on ${day(offer.validUntil, zone)}` });
      continue;
    }
    const eligibleSubtotal = invoice.lines.filter((l) => occasionEligible(l, offer.rules)).reduce((sum, l) => sum + Math.max(l.unitPrice * l.qty - (l.comboDiscount ?? 0), 0), 0);
    const result = occasionDiscount(offer.rules, eligibleSubtotal);
    if (!result.eligible) {
      rows.push({ ...base, canApply: false, code: result.code, reason: notEligibleWords(result), eligibleSubtotal });
      continue;
    }
    if (manual && !base.applied) {
      rows.push({ ...base, canApply: false, code: 'OTHER_DISCOUNT', reason: 'Remove the other discounts on this bill to use this offer', eligibleSubtotal, discount: result.discount });
      continue;
    }
    const priced = base.applied ? invoice : await withOffer(ctx, { ...invoice, offer: null }, offer);
    rows.push({ ...base, canApply: true, eligibleSubtotal, discount: result.discount, payable: priced.grandTotal });
  }
  return { applied: invoice.offer ?? null, offers: rows };
}

// POST /api/invoices/:id/occasion-offer — { offerIssueId | null, version }: put one offer on the draft, or take it off.
// Nothing is used yet: that happens only when the bill is issued.
export async function setInvoiceOffer(ctx, invoiceId, { offerIssueId, version }) {
  const invoice = await loadInvoice(ctx, invoiceId);
  if (invoice.status !== 'DRAFT') throw new AppError(409, 'ALREADY_ISSUED', 'This bill has already been issued');
  if (invoice.version !== version) throw new AppError(409, 'STALE_VERSION', 'This bill was just changed by someone else. Please reload it.');

  let offer = null;
  if (offerIssueId) {
    if (!invoice.customerId) throw new AppError(400, 'CUSTOMER_REQUIRED', 'An occasion offer needs a customer on the bill');
    const found = await OfferIssue.findOne(scoped(ctx, { _id: offerIssueId, customerId: invoice.customerId, superseded: false })).lean();
    if (!found) throw new AppError(404, 'NOT_FOUND', 'Offer not found for this customer');
    if (found.status === 'REDEEMED') throw new AppError(409, 'OFFER_TAKEN', 'This offer has already been used');
    if (found.status !== 'ISSUED' || found.validUntil <= new Date()) throw new AppError(409, 'OFFER_EXPIRED', 'This occasion offer has expired');
    if ((invoice.manualDiscount ?? 0) > 0) throw new AppError(400, 'OFFER_NO_MIXING', 'Remove the other discounts on this bill to use this offer');
    offer = { offerIssueId: found._id, type: found.type, campaignName: found.campaignName, rules: found.rules };
  }

  const { fields, settings } = await priceDraft(ctx, { ...invoice, offer });
  if (offer && !fields.offer.eligible) throw new AppError(400, fields.offer.code, notEligibleWords(fields.offer));

  return mongoose.connection.transaction(async (session) => {
    const updated = await Invoice.findOneAndUpdate(scoped(ctx, { _id: invoice._id, status: 'DRAFT', version }), { $set: fields, $inc: { version: 1 } }, { returnDocument: 'after', session, runValidators: true }).lean();
    if (!updated) throw new AppError(409, 'STALE_VERSION', 'This bill was just changed by someone else. Please reload it.');
    const summary = offer ? `Applied the ${offer.campaignName} offer to ${invoice.customerSnapshot?.name}'s bill: ${formatMoney(fields.offer.discount)} off` : `Took the occasion offer off ${invoice.customerSnapshot?.name}'s bill`;
    await logActivity(ctx, { action: offer ? 'occasions.offer_applied' : 'occasions.offer_removed', branchId: invoice.branchId, invoiceId: invoice._id, summary }, session);
    return present(ctx, updated, { session, settings });
  });
}

// ---------------------------------------------------------------------------
// Bookings
// ---------------------------------------------------------------------------

// A booking made from the occasion list (or with the offer ticked) carries the offer. Same customer, offer still
// available. Booking never uses the offer. Called inside the booking's transaction.
export async function linkOfferToBooking(ctx, appointment, offerIssueId, session) {
  const offer = await OfferIssue.findOne(scoped(ctx, { _id: offerIssueId, customerId: appointment.customerId, status: 'ISSUED', superseded: false })).session(session).lean();
  if (!offer) throw new AppError(400, 'OFFER_NOT_AVAILABLE', 'That occasion offer isn’t available for this customer any more');
  await Appointment.updateOne({ _id: appointment._id }, { $set: { offerIssueId: offer._id, offerLinked: true } }, { session });
  await OfferIssue.updateOne({ _id: offer._id }, { $addToSet: { appointmentIds: appointment._id } }, { session });
  await addOfferEvents(ctx.orgId, [offer], 'BOOKED', { ctx, note: 'Booking linked to the offer (not used yet)' }, session);
}

// GET /api/occasions/customers/:id/live-offers?serviceIds=a,b — the booking form's "Eligible occasion offer" box and
// the check-in badge: offers the customer can still use, with the likely discount on the chosen services
export async function liveOffers(ctx, customerId, { serviceIds = [] } = {}) {
  if (!(await Customer.exists(scoped(ctx, { _id: customerId })))) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const offers = await OfferIssue.find(scoped(ctx, { customerId, status: 'ISSUED', superseded: false, validUntil: { $gt: new Date() } })).sort({ validUntil: 1 }).lean();
  const services = serviceIds.length ? await Service.find(scoped(ctx, { _id: { $in: serviceIds } })).select('price').lean() : [];
  return {
    offers: offers.map((o) => {
      const eligibleSubtotal = services.filter((s) => o.rules.serviceIds.map(String).includes(String(s._id))).reduce((sum, s) => sum + s.price, 0);
      const potential = serviceIds.length ? occasionDiscount(o.rules, eligibleSubtotal) : null;
      return {
        _id: o._id,
        type: o.type,
        label: `${LABEL[o.type]} offer`,
        campaignName: o.campaignName,
        offerSummary: describeOffer(o.rules),
        maxDiscount: o.rules.maxDiscount,
        validUntil: o.validUntil,
        potentialDiscount: potential?.discount ?? null,
        potentialReason: potential && !potential.eligible ? notEligibleWords(potential) : null,
      };
    }),
  };
}
