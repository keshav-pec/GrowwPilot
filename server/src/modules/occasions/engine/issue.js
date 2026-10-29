import mongoose from 'mongoose';
import { Customer, OccasionCampaignVersion, OfferIssue } from '../../../models/index.js';
import { CONSENT_CHANNELS, OCCASION_TYPES } from '../../../config/occasions.js';
import { publishedCampaigns, winningCampaign } from '../campaigns/audience.js';
import { localMonth, monthWindow, taskDueAt } from './window.js';
import { addOfferEvents } from './events.js';

const BATCH = 1000;
const { ObjectId } = mongoose.Types;

// The channels a customer may be messaged on right now (opted in, with somewhere to send it)
export function messageChannels(customer) {
  return CONSENT_CHANNELS.filter((channel) => customer.marketing?.[channel]?.status === 'OPTED_IN' && (channel !== 'EMAIL' || customer.email) && (channel === 'EMAIL' || customer.phone));
}

// The customer details copied onto their offers, so the list can search and filter in the database
export function customerCopy(customer) {
  const channels = messageChannels(customer);
  return { customerName: customer.name, customerPhone: customer.phone, channels, canMessage: channels.length > 0 };
}

// The live campaign each occasion uses at this branch, with its current version: { BIRTHDAY: { campaign, version } }
export async function campaignsForBranch(orgId, branchId) {
  const ctx = { orgId: String(orgId) };
  const result = {};
  for (const type of OCCASION_TYPES) {
    const campaign = winningCampaign(await publishedCampaigns(ctx, type), branchId);
    if (!campaign?.currentVersionId) continue;
    const version = await OccasionCampaignVersion.findOne({ _id: campaign.currentVersionId, orgId }).lean();
    if (version) result[type] = { campaign, version };
  }
  return result;
}

// One "give this customer their offer unless they already have one this year" write. Running it again is harmless.
function upsertOffer({ orgId, customer, type, branch, year, month, now, live }) {
  const { validFrom, validUntil } = monthWindow(year, month, branch.timezone);
  const field = type.toLowerCase();
  return {
    updateOne: {
      filter: { orgId, customerId: customer._id, type, year, superseded: false },
      update: {
        $setOnInsert: {
          orgId,
          customerId: customer._id,
          campaignId: live.campaign._id,
          campaignVersionId: live.version._id,
          campaignName: live.version.name,
          rules: live.version.rules,
          type,
          year,
          month,
          day: customer.occasions?.[field]?.day ?? null,
          branchId: branch._id,
          homeBranchId: branch._id,
          ...customerCopy(customer),
          validFrom,
          validUntil,
          status: 'ISSUED',
          superseded: false,
          issuedAt: now,
          task: { state: 'OPEN', kind: 'CONTACT', dueAt: taskDueAt(now, branch.timezone), attempts: 0 },
        },
      },
      upsert: true,
    },
  };
}

// Writes a batch; another server doing the same at the same moment only causes "already there" errors, which are fine.
// Returns the new offers ([{ _id, customerId }]).
async function writeBatch(orgId, ops) {
  if (ops.length === 0) return [];
  let result;
  try {
    result = await OfferIssue.bulkWrite(ops, { ordered: false });
  } catch (err) {
    if (!err.writeErrors?.every?.((e) => e.code === 11000) && err.code !== 11000) throw err;
    result = err.result;
  }
  const upserted = result?.upsertedIds ?? result?.getUpsertedIds?.() ?? {};
  const created = Object.entries(upserted).map(([index, _id]) => ({ _id, customerId: ops[index].updateOne.filter.customerId }));
  await addOfferEvents(orgId, created, 'ISSUED');
  return created;
}

const customerFields = 'name phone email occasions marketing homeBranchId';

// For one branch and its current month: every customer whose home branch it is and whose occasion is this month
// gets one offer from the winning campaign. Messaging permission is not needed. Safe to run any number of times.
export async function issueForBranch(orgId, branch, { now = new Date() } = {}) {
  const { year, month } = localMonth(now, branch.timezone);
  const campaigns = await campaignsForBranch(orgId, branch._id);
  let issued = 0;
  for (const [type, live] of Object.entries(campaigns)) {
    const cursor = Customer.find({ orgId, homeBranchId: branch._id, [`occasions.${type.toLowerCase()}.month`]: month }).select(customerFields).lean().cursor({ batchSize: BATCH });
    let ops = [];
    for await (const customer of cursor) {
      ops.push(upsertOffer({ orgId: new ObjectId(String(orgId)), customer, type, branch, year, month, now, live }));
      if (ops.length === BATCH) {
        issued += (await writeBatch(orgId, ops)).length;
        ops = [];
      }
    }
    issued += (await writeBatch(orgId, ops)).length;
  }
  return { issued, year, month };
}

// One customer's offer for one occasion now, if their occasion is this month (used after a date or branch change)
export async function issueForCustomer(orgId, customer, type, branch, { now = new Date(), campaigns } = {}) {
  const { year, month } = localMonth(now, branch.timezone);
  if (customer.occasions?.[type.toLowerCase()]?.month !== month) return null;
  const live = (campaigns ?? (await campaignsForBranch(orgId, branch._id)))[type];
  if (!live) return null;
  const [created] = await writeBatch(orgId, [upsertOffer({ orgId: new ObjectId(String(orgId)), customer, type, branch, year, month, now, live })]);
  return created ?? null;
}
