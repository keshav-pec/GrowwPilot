// What a bill needs from GST setup. Billing asks here only for salons that have activated it.
import { Branch, GstRegistration, GstTaxRule } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { todayInZone } from '../../utils/time.js';
import { GST_STATES } from '../../config/billing.js';
import { CATALOG_LINK, GST_SETUP_LINK, PRODUCTS_LINK } from '../../config/gst.js';
import { niceDate, registrationFor, ruleFor } from './gst.rules.js';

export const gstSetupActive = (settings) => settings.gst?.status === 'ACTIVE';

// The registration, rules and place of supply for a bill at this branch.
// place: the state an owner chose ('27'), or empty for the branch's own state. date: defaults to today at the branch.
// blockers: problems that stop a bill being issued. The tax is never just assumed.
export async function billContext(ctx, { branchId, place = null, date = null }, session = null) {
  const branch = await Branch.findById(branchId).select('timezone name').session(session).lean();
  const taxDate = date ?? todayInZone(branch.timezone);
  const registrations = await GstRegistration.find(scoped(ctx)).session(session).lean();
  const rules = await GstTaxRule.find(scoped(ctx, { status: 'APPROVED' })).session(session).lean();
  const registration = registrationFor(registrations, branchId, taxDate);

  const blockers = [];
  if (!registration) blockers.push({ code: 'GSTIN_MISSING', message: `${branch.name} has no GSTIN for ${niceDate(taxDate)}. An owner needs to link it in GST setup.`, link: GST_SETUP_LINK });

  const stateCode = place || registration?.stateCode || null;
  const known = Boolean(stateCode && GST_STATES[stateCode]);
  if (!known) blockers.push({ code: 'PLACE_OF_SUPPLY_UNRESOLVED', message: 'The place of supply for this bill can’t be worked out. An owner needs to choose the state.', link: GST_SETUP_LINK });

  return {
    taxDate,
    registration,
    rules,
    placeOfSupply: { stateCode: known ? stateCode : null, stateName: known ? GST_STATES[stateCode] : null, chosen: Boolean(place) },
    interstate: Boolean(known && registration && stateCode !== registration.stateCode),
    blockers,
  };
}

// A bill line's rate and code from its rule (codeField: 'sacCode' or 'hsnCode'). No rule: taxRuleId stays empty and the line is blocked.
export function ruleTax(gst, groupId, codeField) {
  const rule = ruleFor(gst.rules, groupId, gst.taxDate);
  if (!rule) return { taxRateBps: 0, [codeField]: undefined, taxRuleId: null };
  return { taxRateBps: rule.rateBps, [codeField]: rule.code, taxRuleId: rule._id, taxRuleName: rule.name, itcType: rule.itcType };
}

// The problem with a line that has no approved rule, and where an owner fixes it
export function missingRuleBlocker(line, taxDate) {
  const link = line.kind === 'PRODUCT' ? `${PRODUCTS_LINK}&product=${line.skuId}` : `${CATALOG_LINK}?service=${line.serviceId}`;
  return { code: 'TAX_CLASSIFICATION_MISSING', message: `${line.name} has no approved tax rule for ${niceDate(taxDate)}. An owner needs to link one.`, link, lineId: line._id };
}

// Services and products are linked to a rule of the same kind, in this salon, and only by an owner
export async function assertTaxRuleLink(ctx, kind, groupId) {
  if (groupId === undefined) return;
  if (ctx.role !== 'OWNER') throw new AppError(403, 'PERMISSION_DENIED', 'Only an owner can choose a tax rule');
  if (groupId && !(await GstTaxRule.exists(scoped(ctx, { groupId, kind })))) throw new AppError(400, 'VALIDATION_ERROR', 'That tax rule was not found');
}
