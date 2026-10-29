import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Branch, Invoice, OccasionCampaign, OccasionCampaignVersion, OfferEvent, OfferIssue } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { logActivity } from '../../activity/activity.service.js';
import { CHANNEL_LABELS, MONTH_NAMES, OCCASION_LABELS, maskPhone } from '../../../config/occasions.js';
import { assertCan } from '../permissions.js';

// ---------------------------------------------------------------------------
// Reports → Occasion offers (owners; a branch owner sees their branches). The words (PRD section 16):
//   Offers issued       offers given in the period (a replaced one doesn't count)
//   Contacted           an offer message sent through the app, or a call marked "Reached"
//   Linked bookings     appointments booked for the offer (from the occasion list, or with the offer ticked)
//   Used                offers used on an issued bill (a voided bill gives it back, so it no longer counts)
//   Associated sales    the net value of the bills that used an offer, after refunds. Never called "ROI":
//                       the customer may have come anyway.
//   Discounts given     the offer discount on issued bills (voided bills don't count)
// An offer is in the period when its month overlaps the dates, in its branch's own time zone.
// ---------------------------------------------------------------------------

const oid = (id) => new mongoose.Types.ObjectId(String(id));
const pct = (part, whole) => (whole ? Math.round((part / whole) * 1000) / 10 : 0);

// The branches to report on: 'all' (all mine), 'current', or one id
async function branchesFor(ctx, branch = 'all') {
  const ids = branch === 'all' ? ctx.allowedBranchIds : [branch === 'current' ? ctx.activeBranchId : branch];
  if (!ids.every((id) => ctx.allowedBranchIds.includes(String(id)))) throw new AppError(403, 'BRANCH_FORBIDDEN', 'You do not have access to this branch');
  return Branch.find(scoped(ctx, { _id: { $in: ids } })).select('name timezone').sort({ name: 1 }).lean();
}

// The dates: a month ("2026-11"), or from/to ("2026-11-01" .. "2026-11-30"); this month by default
function periodOf(query, zone) {
  if (query.from || query.to) {
    const from = query.from ?? query.to;
    const to = query.to ?? query.from;
    if (from > to) throw new AppError(400, 'VALIDATION_ERROR', 'The start date is after the end date');
    return { from, to, label: from === to ? DateTime.fromISO(from).toFormat('d LLL yyyy') : `${DateTime.fromISO(from).toFormat('d LLL yyyy')} – ${DateTime.fromISO(to).toFormat('d LLL yyyy')}` };
  }
  const month = query.month ? DateTime.fromISO(`${query.month}-01`) : DateTime.now().setZone(zone).startOf('month');
  return { from: month.toISODate(), to: month.endOf('month').toISODate(), label: `${MONTH_NAMES[month.month - 1]} ${month.year}` };
}

// The offers in the report, with the filters
async function offersFor(ctx, query) {
  const branches = await branchesFor(ctx, query.branch);
  const period = periodOf(query, branches[0]?.timezone ?? 'Asia/Kolkata');
  const filter = {
    orgId: oid(ctx.orgId),
    status: { $ne: 'SUPERSEDED' },
    $or: branches.map((b) => ({
      homeBranchId: b._id,
      validFrom: { $lt: DateTime.fromISO(period.to, { zone: b.timezone }).endOf('day').toJSDate() },
      validUntil: { $gte: DateTime.fromISO(period.from, { zone: b.timezone }).startOf('day').toJSDate() },
    })),
  };
  if (query.type) filter.type = query.type;
  if (query.campaignId) filter.campaignId = oid(query.campaignId);
  if (query.campaignVersionId) filter.campaignVersionId = oid(query.campaignVersionId);
  if (query.channel) filter['task.sentVia'] = query.channel;
  if (query.canMessage) filter.canMessage = query.canMessage === 'yes';
  const offers = branches.length
    ? await OfferIssue.find(filter)
        .select('customerId customerName customerPhone type year month day campaignId campaignName campaignVersionId homeBranchId status canMessage task.contactedAt task.sentVia invoiceId discountGiven')
        .lean()
    : [];
  return { branches, period, offers };
}

// Bookings, bills and staff actions behind the offers
async function factsFor(ctx, offers) {
  const ids = offers.map((o) => o._id);
  const usedIds = offers.filter((o) => o.status === 'REDEEMED').map((o) => o._id);
  const [appointments, bills, events] = await Promise.all([
    ids.length ? Appointment.find({ orgId: oid(ctx.orgId), offerIssueId: { $in: ids }, offerLinked: true }).select('offerIssueId').lean() : [],
    usedIds.length
      ? Invoice.find({ orgId: oid(ctx.orgId), status: 'ISSUED', 'offer.offerIssueId': { $in: usedIds } }).select('offer.offerIssueId occasionDiscountTotal grandTotal creditedTotal invoiceNumber').lean()
      : [],
    ids.length ? OfferEvent.find({ orgId: oid(ctx.orgId), offerId: { $in: ids }, kind: { $in: ['SENT', 'CONTACT', 'BOOKED', 'REDEEMED'] }, actorId: { $ne: null } }).select('kind outcome actorId actorName').lean() : [],
  ]);
  const bookingsOf = new Map();
  for (const a of appointments) bookingsOf.set(String(a.offerIssueId), (bookingsOf.get(String(a.offerIssueId)) ?? 0) + 1);
  const billOf = new Map(bills.map((b) => [String(b.offer.offerIssueId), b]));
  return { bookingsOf, billOf, events, linkedBookings: appointments.length };
}

// The numbers for a set of offers
function measure(offers, { bookingsOf, billOf }) {
  const contacted = offers.filter((o) => o.task?.contactedAt);
  const booked = offers.filter((o) => bookingsOf.has(String(o._id)));
  const used = offers.filter((o) => o.status === 'REDEEMED' && billOf.has(String(o._id)));
  const bills = used.map((o) => billOf.get(String(o._id)));
  return {
    issued: offers.length,
    contacted: contacted.length,
    customersContacted: new Set(contacted.map((o) => String(o.customerId))).size,
    booked: booked.length,
    linkedBookings: offers.reduce((sum, o) => sum + (bookingsOf.get(String(o._id)) ?? 0), 0),
    used: used.length,
    associatedSales: bills.reduce((sum, b) => sum + b.grandTotal - (b.creditedTotal ?? 0), 0),
    discounts: bills.reduce((sum, b) => sum + (b.occasionDiscountTotal ?? 0), 0),
  };
}

// GET /api/occasions/reports — tiles, the steps from eligible to used, money, by branch, staff activity, and the
// campaigns and versions for the filters
export async function occasionReport(ctx, query) {
  assertCan(ctx, 'occasions.viewReports');
  const { branches, period, offers } = await offersFor(ctx, query);
  const facts = await factsFor(ctx, offers);
  const all = measure(offers, facts);

  const byBranch = branches.map((b) => ({ branchId: b._id, branch: b.name, ...measure(offers.filter((o) => String(o.homeBranchId) === String(b._id)), facts) }));

  // Staff activity: what each person did on these offers. No sales are credited to individuals.
  const people = new Map();
  for (const e of facts.events) {
    const row = people.get(String(e.actorId)) ?? { userId: e.actorId, name: e.actorName, messages: 0, calls: 0, reached: 0, linkedBookings: 0, uses: 0 };
    if (e.kind === 'SENT') row.messages += 1;
    if (e.kind === 'CONTACT') row.calls += 1;
    if (e.kind === 'CONTACT' && e.outcome === 'REACHED') row.reached += 1;
    if (e.kind === 'BOOKED') row.linkedBookings += 1;
    if (e.kind === 'REDEEMED') row.uses += 1;
    people.set(String(e.actorId), row);
  }
  const staff = [...people.values()].map((r) => ({ ...r, contacts: r.messages + r.calls })).sort((a, b) => b.contacts - a.contacts || a.name.localeCompare(b.name));

  const campaigns = await OccasionCampaign.find(scoped(ctx, ctx.isPrimaryOwner ? {} : { $or: [{ scope: 'BUSINESS_DEFAULT' }, { branchId: { $in: ctx.allowedBranchIds } }] }))
    .select('name type status')
    .sort({ type: 1, name: 1 })
    .lean();
  const versions = await OccasionCampaignVersion.find(scoped(ctx, { campaignId: { $in: campaigns.map((c) => c._id) } })).select('campaignId version').sort({ version: 1 }).lean();

  return {
    period,
    branches: branches.map((b) => b.name),
    tiles: { issued: all.issued, customersContacted: all.customersContacted, linkedBookings: all.linkedBookings, used: all.used },
    funnel: [
      { step: 'Eligible', count: all.issued },
      { step: 'Contacted', count: all.contacted },
      { step: 'Booked', count: all.booked },
      { step: 'Used', count: all.used },
    ],
    money: { associatedSales: all.associatedSales, discounts: all.discounts, usedPercent: pct(all.used, all.issued) },
    byBranch,
    staff,
    campaigns: campaigns.map((c) => ({ _id: c._id, name: c.name, type: c.type, versions: versions.filter((v) => String(v.campaignId) === String(c._id)).map((v) => ({ _id: v._id, version: v.version })) })),
  };
}

// GET /api/occasions/reports?format=csv — one row per offer, for Excel. Owners only; every download is logged
// with who and which filters.
export async function occasionReportCsv(ctx, query) {
  assertCan(ctx, 'occasions.viewReports');
  const { branches, period, offers } = await offersFor(ctx, query);
  const facts = await factsFor(ctx, offers);
  const versions = await OccasionCampaignVersion.find(scoped(ctx, { _id: { $in: [...new Set(offers.map((o) => String(o.campaignVersionId)))] } })).select('version').lean();
  const versionOf = new Map(versions.map((v) => [String(v._id), v.version]));
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));

  const rows = offers
    .sort((a, b) => a.customerName.localeCompare(b.customerName))
    .map((o) => {
      const bill = facts.billOf.get(String(o._id));
      const used = o.status === 'REDEEMED' && bill;
      return {
        customer: o.customerName,
        phone: maskPhone(o.customerPhone),
        occasion: OCCASION_LABELS[o.type],
        month: `${MONTH_NAMES[o.month - 1]} ${o.year}`,
        campaign: o.campaignName,
        version: versionOf.get(String(o.campaignVersionId)) ?? '',
        branch: branchName.get(String(o.homeBranchId)) ?? '',
        status: { ISSUED: 'Available', REDEEMED: 'Used', EXPIRED: 'Expired', REVOKED: 'Withdrawn' }[o.status] ?? o.status,
        canMessage: o.canMessage ? 'Yes' : 'No',
        contacted: o.task?.contactedAt ? 'Yes' : 'No',
        via: o.task?.sentVia ? CHANNEL_LABELS[o.task.sentVia] : '',
        bookings: facts.bookingsOf.get(String(o._id)) ?? 0,
        bill: used ? bill.invoiceNumber : '',
        discount: used ? bill.occasionDiscountTotal : null,
        sale: used ? bill.grandTotal - (bill.creditedTotal ?? 0) : null,
      };
    });

  const filters = [period.label, branches.length === 1 ? branches[0].name : 'all my branches', query.type && OCCASION_LABELS[query.type], query.channel && `via ${CHANNEL_LABELS[query.channel]}`, query.canMessage && (query.canMessage === 'yes' ? 'can be messaged' : 'in-salon only'), query.campaignId && 'one campaign']
    .filter(Boolean)
    .join(', ');
  await logActivity(ctx, { action: 'occasions.report_exported', branchId: branches.length === 1 ? branches[0]._id : null, summary: `Downloaded the occasion offers report as CSV (${filters}): ${rows.length} offer${rows.length === 1 ? '' : 's'}` });

  return {
    fileName: `occasion-offers-${period.from}-to-${period.to}.csv`,
    columns: [
      { key: 'customer', label: 'Customer' },
      { key: 'phone', label: 'Mobile' },
      { key: 'occasion', label: 'Occasion' },
      { key: 'month', label: 'Month' },
      { key: 'campaign', label: 'Campaign' },
      { key: 'version', label: 'Version' },
      { key: 'branch', label: 'Home branch' },
      { key: 'status', label: 'Offer' },
      { key: 'canMessage', label: 'Can be messaged' },
      { key: 'contacted', label: 'Contacted' },
      { key: 'via', label: 'Message via' },
      { key: 'bookings', label: 'Linked bookings' },
      { key: 'bill', label: 'Bill' },
      { key: 'discount', label: 'Offer discount', money: true },
      { key: 'sale', label: 'Associated sale (net)', money: true },
    ],
    rows,
  };
}
