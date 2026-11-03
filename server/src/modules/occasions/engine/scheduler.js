import { randomUUID } from 'node:crypto';
import { Branch, OccasionEngineRun, OccasionSettings, Organization } from '../../../models/index.js';
import { issueForBranch } from './issue.js';
import { expireOffers } from './expire.js';
import { RUN_FROM_HOUR, localDay } from './window.js';
import { autoEmailCampaignIds, autoSendForBranch } from './autoSend.js';

// The monthly offer run. Every 10 minutes the server looks at each salon with offers switched on and each of
// its active branches, in the branch's own time zone:
//   - from 01:00, once a day, it gives this month's offers (so the 1st of the month gives everyone theirs, and a
//     day missed while the server was down is picked up on the next run)
//   - it expires unused offers whose month is over
//   - on every tick inside the send hours, it emails offers of campaigns set to send automatically (autoSend.js)
// A lock row per branch stops two servers running the same branch at once. Nothing is ever given twice.

const EVERY_MS = 10 * 60 * 1000;
const LOCK_MS = 10 * 60 * 1000;
const SERVER_ID = randomUUID();

// Takes the branch's lock, or returns false if another server holds it
async function lockBranch(orgId, branchId, now) {
  try {
    const row = await OccasionEngineRun.findOneAndUpdate(
      { branchId, $or: [{ lockedUntil: null }, { lockedUntil: { $lt: now } }] },
      { $set: { orgId, lockedUntil: new Date(now.getTime() + LOCK_MS), lockedBy: SERVER_ID } },
      { upsert: true, returnDocument: 'after' }
    ).lean();
    return row?.lockedBy === SERVER_ID ? row : false;
  } catch (err) {
    if (err.code === 11000) return false; // the row exists and is locked
    throw err;
  }
}

async function unlockBranch(branchId, { ranOn, now }) {
  const set = { lockedUntil: null, lockedBy: null };
  if (ranOn) Object.assign(set, { lastRunDate: ranOn, lastRunAt: now });
  await OccasionEngineRun.updateOne({ branchId, lockedBy: SERVER_ID }, { $set: set });
}

// The run's result on the settings page ("Last successful run"). Doesn't change the settings version.
async function recordRun(orgId, { issued, expired, branches, by }, now) {
  await OccasionSettings.updateOne({ orgId }, { $set: { lastRun: { at: now, issued, expired, branches, by } }, $setOnInsert: { orgId } }, { upsert: true });
}

// Automatic emails go only to offers given already, so a branch due its offer run gets those first
async function emailIfAutomatic(orgId, branch, auto, now) {
  if (!auto.campaignIds.length) return 0;
  return (await autoSendForBranch(orgId, branch, { now, settings: auto.settings, campaignIds: auto.campaignIds })).queued;
}

// One salon. force: every branch now, whatever the time and whether it already ran today ("Check now", publishing).
export async function runForOrg(orgId, { now = new Date(), force = false, by = 'SCHEDULE' } = {}) {
  const branches = await Branch.find({ orgId, status: 'active' }).select('name timezone').lean();
  const campaignIds = await autoEmailCampaignIds(orgId);
  const auto = { campaignIds, settings: campaignIds.length ? await OccasionSettings.findOne({ orgId }).select('autoEmail channelOrder').lean() : null };
  let issued = 0;
  let ran = 0;
  let emailed = 0;
  for (const branch of branches) {
    const { date, hour } = localDay(now, branch.timezone);
    let issueDue = true;
    if (!force) {
      if (hour < RUN_FROM_HOUR) issueDue = false;
      else {
        const last = await OccasionEngineRun.findOne({ branchId: branch._id }).select('lastRunDate').lean();
        if (last?.lastRunDate === date) issueDue = false;
      }
    }
    if (!issueDue && !auto.campaignIds.length) continue;
    if (!(await lockBranch(orgId, branch._id, now))) continue;
    try {
      if (issueDue) {
        issued += (await issueForBranch(orgId, branch, { now })).issued;
        ran += 1;
      }
      emailed += await emailIfAutomatic(orgId, branch, auto, now);
      await unlockBranch(branch._id, issueDue ? { ranOn: date, now } : {});
    } catch (err) {
      await unlockBranch(branch._id, {});
      throw err;
    }
  }
  const expired = await expireOffers(orgId, now);
  if (ran > 0 || expired > 0 || force) await recordRun(orgId, { issued, expired, branches: ran, by }, now);
  return { issued, expired, branches: ran, emailed };
}

// Every salon with offers switched on. One salon's problem doesn't stop the others.
export async function runScheduledTick(now = new Date()) {
  const orgs = await Organization.find({ status: 'active', 'occasionOffers.enabled': true }).select('_id').lean();
  for (const org of orgs) {
    try {
      await runForOrg(org._id, { now });
    } catch (err) {
      console.error(`Occasion offers: the run for salon ${org._id} failed:`, err);
    }
  }
}

// Started once when the server starts
export function startOccasionAutomation() {
  const tick = () => runScheduledTick().catch((err) => console.error('Occasion offers:', err));
  setTimeout(tick, 5000).unref();
  setInterval(tick, EVERY_MS).unref();
}
