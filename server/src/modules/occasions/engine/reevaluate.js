import { Branch, Customer, OfferIssue, Organization } from '../../../models/index.js';
import { CONSENT_CHANNELS, OCCASION_TYPES } from '../../../config/occasions.js';
import { localMonth } from './window.js';
import { addOfferEvents } from './events.js';
import { campaignsForBranch, customerCopy, issueForCustomer } from './issue.js';

// This year's offer (not a replaced one) for one customer and occasion, at their home branch's year
export function currentOffer(orgId, customerId, type, year, session = null) {
  return OfferIssue.findOne({ orgId, customerId, type, year, superseded: false }).session(session).lean();
}

// An unused offer that is still running, whose month no longer matches the customer's corrected date
// (or whose date was removed). Returns the offers a date change would replace: [{ offer, type }]
export async function offersAffectedByDates(orgId, customer, newDates, now = new Date()) {
  const home = customer.homeBranchId ? await Branch.findOne({ _id: customer.homeBranchId, orgId }).select('timezone').lean() : null;
  if (!home) return [];
  const { year } = localMonth(now, home.timezone);
  const affected = [];
  for (const type of OCCASION_TYPES) {
    const field = type.toLowerCase();
    if (newDates[field] === undefined) continue;
    const offer = await currentOffer(orgId, customer._id, type, year);
    if (offer?.status === 'ISSUED' && offer.validUntil >= now && offer.month !== (newDates[field]?.month ?? null)) affected.push({ offer, type });
  }
  return affected;
}

// Replaces an unused offer after a date correction: SUPERSEDED, its task closed, and it no longer counts for the year
async function supersede(orgId, offer, ctx, now) {
  const changed = await OfferIssue.updateOne(
    { _id: offer._id, status: 'ISSUED' },
    { $set: { status: 'SUPERSEDED', superseded: true, 'task.state': 'CLOSED', 'task.closedReason': 'REPLACED', 'task.closedAt': now } }
  );
  if (changed.modifiedCount === 1) await addOfferEvents(orgId, [offer], 'SUPERSEDED', { ctx, note: 'The customer’s date was corrected' });
  return changed.modifiedCount === 1;
}

// Brings one customer's offers in line with their details, straight after a change (dates, home branch, name,
// phone, permission) instead of waiting for the next monthly run:
//   - copies name, phone and messaging channels onto their running offers
//   - an unused running offer whose month no longer matches the date is replaced (a day change in the same month does nothing)
//   - a running offer follows the customer to a new home branch (no second offer)
//   - if their occasion is this month and they have no offer this year yet, they get one
// A used offer stays as it is and no second offer is given that year. ctx: who made the change (null = the app).
export async function reevaluateCustomer(orgId, customerId, { ctx = null, now = new Date() } = {}) {
  const customer = await Customer.findOne({ _id: customerId, orgId }).select('name phone email occasions marketing homeBranchId').lean();
  if (!customer) return;
  await OfferIssue.updateMany({ orgId, customerId: customer._id, status: { $in: ['ISSUED', 'REDEEMED'] } }, { $set: customerCopy(customer) });

  // Opted out of every channel: nothing left to follow up (the offer itself still works in the salon)
  if (CONSENT_CHANNELS.every((c) => customer.marketing?.[c]?.status === 'OPTED_OUT')) {
    const open = await OfferIssue.find({ orgId, customerId: customer._id, status: 'ISSUED', 'task.state': { $ne: 'CLOSED' }, 'task.kind': 'CONTACT' }).select('customerId').lean();
    if (open.length) {
      await OfferIssue.updateMany({ _id: { $in: open.map((o) => o._id) }, 'task.state': { $ne: 'CLOSED' } }, { $set: { 'task.state': 'CLOSED', 'task.closedReason': 'OPTED_OUT', 'task.closedAt': now } });
      await addOfferEvents(orgId, open, 'CONTACT', { ctx, note: 'Task closed: the customer opted out of all messages' });
    }
  }

  const org = await Organization.findById(orgId).select('occasionOffers').lean();
  if (!org?.occasionOffers?.enabled) return; // switched off: no new offers
  const home = customer.homeBranchId ? await Branch.findOne({ _id: customer.homeBranchId, orgId, status: 'active' }).select('name timezone').lean() : null;
  if (!home) return;
  const { year } = localMonth(now, home.timezone);
  let campaigns = null;

  for (const type of OCCASION_TYPES) {
    let offer = await currentOffer(orgId, customer._id, type, year);
    const wanted = customer.occasions?.[type.toLowerCase()]?.month ?? null;
    if (offer?.status === 'ISSUED' && offer.validUntil >= now && offer.month !== wanted) {
      if (await supersede(orgId, offer, ctx, now)) offer = null;
    }
    if (offer?.status === 'ISSUED' && String(offer.homeBranchId) !== String(home._id)) {
      await OfferIssue.updateOne({ _id: offer._id, status: 'ISSUED' }, { $set: { homeBranchId: home._id, 'task.assigneeId': null } });
      await addOfferEvents(orgId, [offer], 'MOVED', { ctx, note: `Home branch changed to ${home.name}` });
    }
    if (!offer) {
      campaigns ??= await campaignsForBranch(orgId, home._id);
      await issueForCustomer(orgId, customer, type, home, { now, campaigns });
    }
  }
}

// Runs reevaluateCustomer without holding up the screen; a failure is only logged (the monthly run catches up)
export function reevaluateSoon(orgId, customerIds, options) {
  (async () => {
    for (const id of customerIds) await reevaluateCustomer(orgId, id, options);
  })().catch((err) => console.error('Occasion offers: re-check failed:', err));
}
