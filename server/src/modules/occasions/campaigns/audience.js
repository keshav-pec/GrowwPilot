import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Branch, Customer, OccasionCampaign } from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';
import { CONSENT_CHANNELS, maskPhone } from '../../../config/occasions.js';

const { ObjectId } = mongoose.Types;

// Which month it is now at every active branch, in the branch's own time zone (late on 31 October in
// Kolkata it can still be October in Dubai). Map branchId -> { branch, month, year }
export async function branchMonths(ctx, now = new Date(), session = null) {
  const branches = await Branch.find(scoped(ctx, { status: 'active' })).select('name timezone').session(session).lean();
  return new Map(
    branches.map((b) => {
      const local = DateTime.fromJSDate(now, { zone: b.timezone || 'Asia/Kolkata' });
      return [String(b._id), { branch: b, month: local.month, year: local.year }];
    })
  );
}

// The live campaigns of one occasion: { salon: the salon-wide one or null, byBranch: Map branchId -> branch campaign }
export async function publishedCampaigns(ctx, type, session = null) {
  const live = await OccasionCampaign.find(scoped(ctx, { type, status: 'PUBLISHED' })).session(session).lean();
  return {
    salon: live.find((c) => c.scope === 'BUSINESS_DEFAULT') ?? null,
    byBranch: new Map(live.filter((c) => c.scope === 'BRANCH_ONLY').map((c) => [String(c.branchId), c])),
  };
}

// The campaign a customer gets: their home branch's own campaign if it is live, otherwise the salon-wide one
export function winningCampaign(published, homeBranchId) {
  return published.byBranch.get(String(homeBranchId)) ?? published.salon ?? null;
}

// The home branches a campaign covers (as if it were live): a branch campaign its own branch; the salon-wide
// one every active branch that has no live campaign of its own for this occasion.
function coveredBranches(campaign, months, published) {
  if (campaign.scope === 'BRANCH_ONLY') return months.has(String(campaign.branchId)) ? [String(campaign.branchId)] : [];
  return [...months.keys()].filter((id) => {
    const own = published.byBranch.get(id);
    return !own || String(own._id) === String(campaign._id);
  });
}

const optedIn = { $or: CONSENT_CHANNELS.map((channel) => ({ [`marketing.${channel}.status`]: 'OPTED_IN' })) };

// Who a campaign would reach this month, as if it were live. Nothing is saved.
// A branch owner only counts their own branches' customers. Returns { eligible, canMessage, customers (first `limit`) }
export async function campaignAudience(ctx, campaign, { limit = 50, now = new Date() } = {}) {
  const [months, published] = await Promise.all([branchMonths(ctx, now), publishedCampaigns(ctx, campaign.type)]);
  let branchIds = coveredBranches(campaign, months, published);
  if (!ctx.isPrimaryOwner) branchIds = branchIds.filter((id) => ctx.allowedBranchIds.includes(id));
  if (branchIds.length === 0) return { eligible: 0, canMessage: 0, customers: [] };

  const field = `occasions.${campaign.type.toLowerCase()}`;
  const filter = scoped(ctx, { $or: branchIds.map((id) => ({ homeBranchId: new ObjectId(id), [`${field}.month`]: months.get(id).month })) });
  const [eligible, canMessage, customers] = await Promise.all([
    Customer.countDocuments(filter),
    Customer.countDocuments({ $and: [filter, optedIn] }),
    limit > 0 ? Customer.find(filter).select(`name phone homeBranchId marketing ${field}`).sort({ name: 1 }).limit(limit).lean() : [],
  ]);
  return {
    eligible,
    canMessage,
    customers: customers.map((c) => ({
      _id: c._id,
      name: c.name,
      phone: maskPhone(c.phone),
      date: c.occasions?.[campaign.type.toLowerCase()],
      homeBranchName: months.get(String(c.homeBranchId))?.branch.name ?? null,
      canMessage: CONSENT_CHANNELS.some((channel) => c.marketing?.[channel]?.status === 'OPTED_IN'),
    })),
  };
}
