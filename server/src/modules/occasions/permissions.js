import { AppError } from '../../utils/AppError.js';
import { logActivity } from '../activity/activity.service.js';

// Who may do what in Birthday & Anniversary Offers: the PRD's section 3 table, in one place.
//
//   assertCan(ctx, 'occasions.manageSettings');   // throws PERMISSION_DENIED for anyone but the business owner
//
// Branch walls (e.g. a branch owner only imports their branches' customers) are checked where the data is read or saved.

// The three kinds of people who use occasion offers
export function occasionsRole(ctx) {
  if (ctx.role === 'OWNER') return ctx.isPrimaryOwner ? 'BUSINESS_OWNER' : 'BRANCH_OWNER';
  if (ctx.role === 'FRONT_DESK') return 'FRONT_DESK';
  return null; // Super Admin and inventory logins: no access
}

const RULES = {
  // Settings page: the switch, the data counts and the consent wording
  'occasions.viewSettings': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: false },
  'occasions.manageSettings': { BUSINESS_OWNER: true, BRANCH_OWNER: false, FRONT_DESK: false },
  // A customer's birthday, anniversary and home branch
  'occasions.editDates': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: true },
  'occasions.editHomeBranch': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: true },
  // Messaging permission (the front desk must also tick "Customer asked for this" to record it)
  'occasions.viewConsent': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: true },
  'occasions.recordConsent': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: true },
  'occasions.withdrawConsent': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: true },
  // Spreadsheet import of birthdays and anniversaries
  'occasions.importDates': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: false },
  // Clear a customer's dates and set every channel to "opted out" (stand-in for an erasure request)
  'occasions.removeData': { BUSINESS_OWNER: true, BRANCH_OWNER: false, FRONT_DESK: false },
  // Campaigns. A branch owner only manages "This branch only" campaigns of their own branches and sees the
  // salon-wide ones read-only (checked in campaigns.service.js).
  'occasions.viewCampaigns': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: false },
  'occasions.manageCampaigns': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: false },
  'occasions.manageSalonCampaigns': { BUSINESS_OWNER: true, BRANCH_OWNER: false, FRONT_DESK: false },
  // The occasion list (each sees their own branches' customers), the emergency withdraw, and "Check now"
  'occasions.viewOffers': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: true },
  'occasions.revokeOffers': { BUSINESS_OWNER: true, BRANCH_OWNER: false, FRONT_DESK: false },
  'occasions.runEngine': { BUSINESS_OWNER: true, BRANCH_OWNER: false, FRONT_DESK: false },
  // Follow-up on their branches' offers: send the message, record a call, assign
  'occasions.followUp': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: true },
  // Reports and their CSV (a branch owner: their branches). The front desk sees only the widget counts.
  'occasions.viewReports': { BUSINESS_OWNER: true, BRANCH_OWNER: true, FRONT_DESK: false },
};

export const OCCASION_ACTIONS = Object.keys(RULES);

export function can(ctx, action) {
  const rules = RULES[action];
  if (!rules) throw new Error(`Unknown occasions action: ${action}`);
  return rules[occasionsRole(ctx)] === true;
}

export function assertCan(ctx, action) {
  if (!can(ctx, action)) throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to do this');
}

// Same, but a refused attempt is written to the activity log first (PRD AT-31: a front desk edit is refused
// and logged). `what` says what they tried, e.g. "edit the campaign Birthday Month Offer".
export async function assertCanOrLog(ctx, action, what) {
  if (!can(ctx, action)) await refuseAndLog(ctx, what);
}

// Logs the refused attempt (outside any transaction, so it stays even though the change doesn't happen) and throws
export async function refuseAndLog(ctx, what) {
  await logActivity(ctx, { action: 'occasions.refused', branchId: ctx.activeBranchId ?? null, summary: `Was refused: tried to ${what}` });
  throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to do this');
}

// What this user may do, for the screens: { 'occasions.importDates': true, ... }
export function capabilities(ctx) {
  return Object.fromEntries(OCCASION_ACTIONS.map((action) => [action, can(ctx, action)]));
}
