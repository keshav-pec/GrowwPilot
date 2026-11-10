// GST setup's date logic and checks. Pure functions (no database). Dates are "YYYY-MM-DD" text, which sorts correctly.
import { DateTime } from 'luxon';
import { GST_STATES, isValidGstin } from '../../config/billing.js';
import { CATALOG_LINK, GST_SETUP_LINK, PRODUCTS_LINK } from '../../config/gst.js';

const FOREVER = '9999-12-31';

// "2026-11-06" -> "6 Nov 2026", for messages people read
export const niceDate = (date) => DateTime.fromISO(date).toFormat('d LLL yyyy');
export const dayBefore = (date) => DateTime.fromISO(date).minus({ days: 1 }).toISODate();
export const coversDate = (period, date) => period.from <= date && date <= (period.to ?? FOREVER);
export const periodsOverlap = (a, b) => a.from <= (b.to ?? FOREVER) && b.from <= (a.to ?? FOREVER);

// The registration a branch uses on a date, or null
export function registrationFor(registrations, branchId, date) {
  return registrations.find((r) => r.branches.some((link) => String(link.branchId) === String(branchId) && coversDate(link, date))) ?? null;
}

// The approved rule of a group on a date, or null
export function ruleFor(rules, groupId, date) {
  if (!groupId) return null;
  return rules.find((r) => r.status === 'APPROVED' && String(r.groupId) === String(groupId) && coversDate(r, date)) ?? null;
}

// Rows of a group that clash with `rule`. An approved rule with no end date that started earlier is not a clash:
// it ends the day before `rule` starts, when `rule` is approved.
export function clashingRules(peers, rule) {
  return peers.filter((p) => String(p._id) !== String(rule._id) && periodsOverlap(p, rule) && !(p.status === 'APPROVED' && !p.to && p.from < rule.from));
}

// ---------------------------------------------------------------------------
// What must be true before a salon activates. Every check says what is wrong and where to fix it.
// -> [{ key, label, ok, code?, message?, link? }]
// ---------------------------------------------------------------------------
const names = (items) => {
  const list = items.slice(0, 3).map((i) => i.name).join(', ');
  return items.length > 3 ? `${list} and ${items.length - 3} more` : list;
};

// Draft rows that cover `date` in groups with no approved row for that date, and that some item points to.
// Activating approves these.
export function draftsToApprove(rules, items, date) {
  const waiting = new Set(items.filter((i) => i.taxRuleGroupId && !ruleFor(rules, i.taxRuleGroupId, date)).map((i) => String(i.taxRuleGroupId)));
  return rules.filter((r) => r.status === 'DRAFT' && waiting.has(String(r.groupId)) && coversDate(r, date));
}

// rules: every rule of the salon. Before activating, a draft for today counts, because activating approves it.
export function setupChecks({ settings, today, branches, registrations, rules, services, products }) {
  const gst = settings.gst ?? {};
  const checks = [];
  const add = (key, label, problem, link = GST_SETUP_LINK) => checks.push({ key, label, ok: !problem, ...(problem ? { code: problem.code, message: problem.message, link } : {}) });

  add('scheme', 'Registration type is Regular', gst.scheme === 'REGULAR' ? null : { code: 'REGIME_NOT_SUPPORTED', message: 'Choose Regular and press Save. That also adds ready-made tax rules for your services and products.' });
  if (gst.scheme !== 'REGULAR') return checks; // Save moves the GSTINs over and adds the rules, so nothing else can be checked yet
  add('startMonth', 'Start month chosen', gst.startMonth ? null : { code: 'START_MONTH_MISSING', message: 'Choose the first month your returns will come from the app.' });

  const active = branches.filter((b) => b.status !== 'archived');
  for (const branch of active) {
    const reg = registrationFor(registrations, branch._id, today);
    let problem = null;
    if (!reg) problem = { code: 'BRANCH_MAPPING_MISSING', message: `${branch.name} has no GSTIN for today. Link it to a registration.` };
    else if (!isValidGstin(reg.gstin)) problem = { code: 'REGISTRATION_INVALID', message: `The GSTIN ${reg.gstin} for ${branch.name} doesn’t look right. Add a corrected registration.` };
    else if (reg.gstin.slice(0, 2) !== reg.stateCode) problem = { code: 'REGISTRATION_INVALID', message: `The GSTIN ${reg.gstin} for ${branch.name} belongs to ${GST_STATES[reg.gstin.slice(0, 2)]}, not ${GST_STATES[reg.stateCode] ?? reg.stateCode}. Add a corrected registration.` };
    add(`branch:${branch._id}`, `${branch.name} has a valid GSTIN`, problem);
  }
  if (active.length === 0) add('branches', 'At least one active branch', { code: 'BRANCH_MAPPING_MISSING', message: 'Add a branch first.' }, '/app/branches');

  const setupActive = gst.status === 'ACTIVE';
  const hasDraft = (item) => rules.some((r) => r.status === 'DRAFT' && String(r.groupId) === String(item.taxRuleGroupId) && coversDate(r, today));
  const unruled = (items) => items.filter((item) => !ruleFor(rules, item.taxRuleGroupId, today) && (setupActive || !hasDraft(item)));
  const ruleCheck = (key, label, items, kind, fixLink) => {
    const missing = unruled(items);
    if (missing.length === 0) return add(key, label, null);
    // Nothing linked yet: the Link button in Tax rules fixes it here. Linked to a rule with no row for today: fix the rule.
    const linked = missing.some((item) => item.taxRuleGroupId);
    const hasRuleOfKind = rules.some((r) => r.kind === kind);
    const fix = linked ? 'Add a rate for today to its tax rule below.' : hasRuleOfKind ? 'Link them in Tax rules below.' : 'Press Save above to add a ready-made tax rule for them.';
    add(key, label, { code: 'TAX_CLASSIFICATION_MISSING', message: `No tax rule: ${names(missing)}. ${fix}` }, setupActive ? fixLink : GST_SETUP_LINK);
  };
  ruleCheck('services', 'Every service has a tax rule', services, 'SERVICE', CATALOG_LINK);
  if (products.length > 0) ruleCheck('products', 'Every product for sale has a tax rule', products, 'PRODUCT', PRODUCTS_LINK);
  return checks;
}
