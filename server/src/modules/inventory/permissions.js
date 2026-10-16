import { AppError } from '../../utils/AppError.js';

// Who may do what in Inventory: the "Who can do what" table in INVENTORY_PLAN.md, in one place.
//
//   const decision = can(ctx, 'inventory.writeOff', { settings, value: 150000 });
//   // -> { allowed: true, needsApproval: false }
//
// `settings` are the branch's inventory settings (front desk switches and limits, see settings.service.js).
// `value` is what the action is worth, in paise. It is only needed for actions with a limit;
// an unknown value always counts as over the limit.
//
// Branch access is not checked here: tenantContext already makes sure the branch is one the user may use.
// Scoping finer than a branch (e.g. "products used only at their branch") is checked where the data is saved.

const ALLOW = Object.freeze({ allowed: true, needsApproval: false });
const DENY = Object.freeze({ allowed: false, needsApproval: false });
const NEEDS_APPROVAL = Object.freeze({ allowed: true, needsApproval: true });

// The four kinds of people who use Inventory
export function inventoryRole(ctx) {
  if (ctx.role === 'OWNER') return ctx.isPrimaryOwner ? 'BUSINESS_OWNER' : 'BRANCH_OWNER';
  if (ctx.role === 'INVENTORY' || ctx.role === 'FRONT_DESK') return ctx.role;
  return null; // Super Admin: no access to a salon's stock
}

// Front desk: only when an owner has switched this job on for the branch
const delegated = (job) => (settings) => (settings.frontDesk[job] ? ALLOW : DENY);

// Up to a limit from the branch settings. Above it: refused, or allowed but waiting for an owner's approval.
const upTo = (limit, overLimit) => (settings, { value } = {}) =>
  Number.isInteger(value) && value <= settings.limits[limit] ? ALLOW : overLimit;

// action -> what each role gets: true, false, NEEDS_APPROVAL, or a rule (settings, options) => decision
const RULES = {
  'inventory.view': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: true },
  'inventory.viewCosts': { BUSINESS_OWNER: true, BRANCH_OWNER: (s) => (s.branchOwnerSeesCosts ? ALLOW : DENY), INVENTORY: false, FRONT_DESK: false },
  'inventory.editProducts': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: false },
  'inventory.issue': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: delegated('issue') },
  'inventory.return': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: delegated('issue') },
  'inventory.transfer': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: delegated('transfer') },
  'inventory.finish': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: delegated('finish') },
  'inventory.correctFinish': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: false, FRONT_DESK: false },
  'inventory.writeOff': {
    BUSINESS_OWNER: true,
    BRANCH_OWNER: upTo('branchOwnerWriteOff', NEEDS_APPROVAL),
    INVENTORY: upTo('inventoryWriteOff', NEEDS_APPROVAL),
    FRONT_DESK: false, // the front desk can only report a problem
  },
  'inventory.reportProblem': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: true },
  'inventory.createPurchaseOrder': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: NEEDS_APPROVAL, FRONT_DESK: false },
  'inventory.approvePurchaseOrder': { BUSINESS_OWNER: true, BRANCH_OWNER: upTo('branchOwnerPoApproval', DENY), INVENTORY: false, FRONT_DESK: false },
  'inventory.receive': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: delegated('receive') },
  // Automatic use by services: post or dismiss uses that couldn't be taken, correct a measured amount
  'inventory.resolveExceptions': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: false },
  'inventory.dismissExceptions': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: false, FRONT_DESK: false },
  'inventory.correctServiceUse': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: false },
  'inventory.viewRecipes': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: false },
  'inventory.editRecipes': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: false, FRONT_DESK: false },
  'inventory.countStock': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: false },
  'inventory.approveStockCount': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: false, FRONT_DESK: false },
  'inventory.viewReports': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: true, FRONT_DESK: false },
  'inventory.manageSettings': { BUSINESS_OWNER: true, BRANCH_OWNER: true, INVENTORY: false, FRONT_DESK: false },
};

export const INVENTORY_ACTIONS = Object.keys(RULES);

export function can(ctx, action, { settings, ...options } = {}) {
  const rules = RULES[action];
  if (!rules) throw new Error(`Unknown inventory action: ${action}`);

  const rule = rules[inventoryRole(ctx)] ?? false;
  if (rule === true) return ALLOW;
  if (rule === false) return DENY;
  if (typeof rule === 'function') return rule(settings, options);
  return rule; // NEEDS_APPROVAL
}

// Same as can(), but throws PERMISSION_DENIED when the action isn't allowed. Returns the decision.
export function assertCan(ctx, action, options) {
  const decision = can(ctx, action, options);
  if (!decision.allowed) throw new AppError(403, 'PERMISSION_DENIED', 'You do not have permission to do this');
  return decision;
}

// What this user may do at the branch, for the screens: { 'inventory.issue': true, ... }.
// Actions with a limit count as allowed here (the limit is checked on the real request).
export function capabilities(ctx, settings) {
  return Object.fromEntries(INVENTORY_ACTIONS.map((action) => [action, can(ctx, action, { settings, value: 0 }).allowed]));
}
