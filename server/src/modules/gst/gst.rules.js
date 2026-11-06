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

export function setupChecks({ settings, today, branches, registrations, rules, services, products }) {
  const gst = settings.gst ?? {};
  const checks = [];
  const add = (key, label, problem, link = GST_SETUP_LINK) => checks.push({ key, label, ok: !problem, ...(problem ? { code: problem.code, message: problem.message, link } : {}) });

  add('scheme', 'Registration type is Regular', gst.scheme === 'REGULAR' ? null : { code: 'REGIME_NOT_SUPPORTED', message: 'Choose Regular and press Save. That also adds the starter 5% tax rule.' });
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

  const unruled = (items) => items.filter((item) => !ruleFor(rules, item.taxRuleGroupId, today));
  const noRuleServices = unruled(services);
  add('services', 'Every service has an approved tax rule', noRuleServices.length ? { code: 'TAX_CLASSIFICATION_MISSING', message: `No approved tax rule: ${names(noRuleServices)}.` } : null, CATALOG_LINK);
  const noRuleProducts = unruled(products);
  if (products.length > 0) add('products', 'Every product for sale has an approved tax rule', noRuleProducts.length ? { code: 'TAX_CLASSIFICATION_MISSING', message: `No approved tax rule: ${names(noRuleProducts)}.` } : null, PRODUCTS_LINK);

  add('testBill', 'A test bill was tried', gst.testBillAt ? null : { code: 'TEST_BILL_MISSING', message: 'Try a test bill below and check the tax.' });
  return checks;
}
