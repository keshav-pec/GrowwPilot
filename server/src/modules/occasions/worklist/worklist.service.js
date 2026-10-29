import mongoose from 'mongoose';
import { Branch, Customer, OfferEvent, OfferIssue, User } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { escapeRegex } from '../../../utils/regex.js';
import { CONSENT_CHANNELS, maskPhone } from '../../../config/occasions.js';
import { assertCan } from '../permissions.js';
import { describeOffer } from '../campaigns/campaign.rules.js';
import { localMonth } from '../engine/window.js';

const { ObjectId } = mongoose.Types;

// The occasion list for the front desk and owners. Everyone sees the offers of customers whose home branch is
// one of their branches; the list follows a customer who moves branch.

function assertListOpen(ctx) {
  assertCan(ctx, 'occasions.viewOffers');
  if (!ctx.occasionOffers) throw new AppError(409, 'FEATURE_OFF', 'Birthday & Anniversary Offers are switched off');
}

// Which home branches to show: 'current' (the branch picked in the switcher), 'all' (all my branches) or one id
function branchFilter(ctx, branch = 'current') {
  if (branch === 'all') return ctx.allowedBranchIds.map((id) => new ObjectId(id));
  const id = branch === 'current' ? ctx.activeBranchId : branch;
  if (!ctx.allowedBranchIds.includes(String(id))) throw new AppError(403, 'BRANCH_FORBIDDEN', 'You do not have access to this branch');
  return [new ObjectId(String(id))];
}

// The month to show: the one asked for, otherwise this month at the current branch
async function monthOf(ctx, { year, month }) {
  if (year && month) return { year, month };
  const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).select('timezone').lean();
  return localMonth(new Date(), branch?.timezone ?? 'Asia/Kolkata');
}

// Task open = the front desk still has something to do (contact the customer, or tell them it was withdrawn)
const NEEDS_ACTION = { 'task.state': 'OPEN', status: { $in: ['ISSUED', 'REVOKED'] } };
const TABS = {
  action: NEEDS_ACTION,
  all: { status: { $ne: 'SUPERSEDED' } },
  contacted: { 'task.contactedAt': { $ne: null }, status: { $ne: 'SUPERSEDED' } },
  booked: { 'appointmentIds.0': { $exists: true }, status: { $ne: 'SUPERSEDED' } },
  used: { status: 'REDEEMED' },
  excluded: { status: { $in: ['EXPIRED', 'REVOKED'] } },
};

function baseFilter(ctx, { branch, year, month, type }) {
  const filter = scoped(ctx, { homeBranchId: { $in: branchFilter(ctx, branch) }, year, month });
  if (type) filter.type = type;
  return filter;
}

// What the front desk should do next, in plain words
export function nextAction(offer) {
  if (offer.status === 'REVOKED') return offer.task?.state === 'OPEN' ? 'Tell the customer the offer was withdrawn' : null;
  if (offer.status === 'REDEEMED') return null;
  if (offer.status !== 'ISSUED') return null;
  if (offer.appointmentIds?.length) return 'Bill with the offer';
  if (offer.task?.state === 'OPEN') return offer.canMessage ? 'Send offer' : 'Call or tell at the next visit';
  if (offer.task?.contactedAt) return 'Book';
  return null;
}

async function userNames(ctx, ids) {
  const unique = [...new Set(ids.filter(Boolean).map(String))];
  if (unique.length === 0) return new Map();
  const users = await User.find(scoped(ctx, { _id: { $in: unique } })).select('name').lean();
  return new Map(users.map((u) => [String(u._id), u.name]));
}

function toRow(offer, names, branchNames) {
  return {
    _id: offer._id,
    customerId: offer.customerId,
    customerName: offer.customerName,
    phone: maskPhone(offer.customerPhone),
    type: offer.type,
    month: offer.month,
    day: offer.day,
    year: offer.year,
    campaignName: offer.campaignName,
    offerSummary: describeOffer(offer.rules),
    validUntil: offer.validUntil,
    channels: offer.channels,
    canMessage: offer.canMessage,
    status: offer.status,
    homeBranchName: branchNames.get(String(offer.homeBranchId)) ?? null,
    booked: offer.appointmentIds?.length ?? 0,
    task: { ...offer.task, assigneeName: offer.task?.assigneeId ? (names.get(String(offer.task.assigneeId)) ?? null) : null },
    nextAction: nextAction(offer),
  };
}

const encodeCursor = (offer) => Buffer.from(JSON.stringify([offer.customerName, String(offer._id)])).toString('base64url');
function decodeCursor(cursor) {
  try {
    const [name, id] = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    return { name: String(name), id: new ObjectId(String(id)) };
  } catch {
    throw new AppError(400, 'VALIDATION_ERROR', 'Invalid page');
  }
}

// GET /api/occasions/offers — one page (sorted by name), all filtering in the database.
// query: { tab, search, type, year, month, canMessage, assignee, branch, cursor, limit }
export async function listOffers(ctx, query) {
  assertListOpen(ctx);
  const { year, month } = await monthOf(ctx, query);
  const filter = { ...baseFilter(ctx, { ...query, year, month }), ...TABS[query.tab ?? 'action'] };
  if (query.canMessage) filter.canMessage = query.canMessage === 'yes';
  if (query.assignee === 'me') filter['task.assigneeId'] = new ObjectId(ctx.userId);
  else if (query.assignee === 'none') filter['task.assigneeId'] = null;
  else if (query.assignee) filter['task.assigneeId'] = new ObjectId(query.assignee);
  const and = [];
  if (query.search) {
    const digits = query.search.replace(/\D/g, '');
    const or = [{ customerName: new RegExp(escapeRegex(query.search), 'i') }];
    if (digits.length >= 3) or.push({ customerPhone: { $regex: digits } });
    and.push({ $or: or });
  }
  if (query.cursor) {
    const after = decodeCursor(query.cursor);
    and.push({ $or: [{ customerName: { $gt: after.name } }, { customerName: after.name, _id: { $gt: after.id } }] });
  }
  if (and.length) filter.$and = and;

  const limit = query.limit ?? 50;
  const offers = await OfferIssue.find(filter).sort({ customerName: 1, _id: 1 }).limit(limit + 1).lean();
  const page = offers.slice(0, limit);
  const [names, branches] = await Promise.all([userNames(ctx, page.map((o) => o.task?.assigneeId)), Branch.find(scoped(ctx)).select('name').lean()]);
  const branchNames = new Map(branches.map((b) => [String(b._id), b.name]));
  return { year, month, offers: page.map((o) => toRow(o, names, branchNames)), nextCursor: offers.length > limit ? encodeCursor(page.at(-1)) : null };
}

// GET /api/occasions/offers/summary — the four tiles (and the Dashboard / Today widget)
export async function offerSummary(ctx, query) {
  assertListOpen(ctx);
  const { year, month } = await monthOf(ctx, query);
  const base = baseFilter(ctx, { ...query, year, month });
  const [eligible, needsAction, booked, used] = await Promise.all([
    OfferIssue.countDocuments({ ...base, ...TABS.all }),
    OfferIssue.countDocuments({ ...base, ...NEEDS_ACTION }),
    OfferIssue.countDocuments({ ...base, ...TABS.booked, status: 'ISSUED' }),
    OfferIssue.countDocuments({ ...base, ...TABS.used }),
  ]);
  return { year, month, eligible, needsAction, booked, used };
}

// GET /api/occasions/offers/:id — the side drawer: the offer, its timeline and the customer's messaging permission
export async function getOffer(ctx, id) {
  assertListOpen(ctx);
  const offer = await OfferIssue.findOne(scoped(ctx, { _id: id, homeBranchId: { $in: ctx.allowedBranchIds } })).lean();
  if (!offer) throw new AppError(404, 'NOT_FOUND', 'Offer not found');
  const [events, customer, branches] = await Promise.all([
    OfferEvent.find(scoped(ctx, { offerId: offer._id })).sort({ createdAt: 1, _id: 1 }).lean(),
    Customer.findOne(scoped(ctx, { _id: offer.customerId })).select('name email marketing').lean(),
    Branch.find(scoped(ctx, { _id: { $in: [offer.branchId, offer.homeBranchId] } })).select('name timezone').lean(),
  ]);
  const names = await userNames(ctx, [offer.task?.assigneeId]);
  const branchNames = new Map(branches.map((b) => [String(b._id), b.name]));
  return {
    offer: {
      ...toRow(offer, names, branchNames),
      rules: offer.rules,
      validFrom: offer.validFrom,
      issuedAt: offer.issuedAt,
      revokedReason: offer.revokedReason,
      branchName: branchNames.get(String(offer.branchId)) ?? null,
      branchTimezone: branches.find((b) => String(b._id) === String(offer.branchId))?.timezone ?? null,
    },
    permission: CONSENT_CHANNELS.map((channel) => ({ channel, status: customer?.marketing?.[channel]?.status ?? 'UNKNOWN', available: channel !== 'EMAIL' || Boolean(customer?.email) })),
    events: events.map((e) => ({ _id: e._id, kind: e.kind, actorName: e.actorName, note: e.note, createdAt: e.createdAt })),
  };
}

// GET /api/occasions/customers/:id/offers — the "Occasion offers" card on the profile: this year's and last year's
export async function customerOffers(ctx, customerId) {
  assertCan(ctx, 'occasions.viewOffers');
  if (!(await Customer.exists(scoped(ctx, { _id: customerId })))) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const thisYear = new Date().getUTCFullYear();
  const offers = await OfferIssue.find(scoped(ctx, { customerId, year: { $gte: thisYear - 1 } })).sort({ year: -1, month: -1, createdAt: -1 }).lean();
  return {
    offers: offers.map((o) => ({ _id: o._id, type: o.type, year: o.year, month: o.month, campaignName: o.campaignName, offerSummary: describeOffer(o.rules), validUntil: o.validUntil, status: o.status, discountGiven: o.discountGiven })),
  };
}
