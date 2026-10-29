import { formatAmount } from '../../../utils/money.js';

// Campaign terms: checks and plain wording. Pure functions, no database.
// PERCENT: value in basis points (1500 = 15%), maxDiscount needed. FLAT: value in paise. Money in paise.

export const MAX_DISCOUNT_CAP = 1_00_000_00; // ₹1,00,000: the most a % offer may take off
export const MAX_NAME = 80;

// The starting suggestions, saved as drafts in the quick setup
export const STARTER_CAMPAIGNS = {
  BIRTHDAY: { name: 'Birthday Month Offer', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: 500_00, minSubtotal: 0 } },
  ANNIVERSARY: { name: 'Anniversary Month Offer', rules: { discountType: 'FLAT', value: 300_00, maxDiscount: null, minSubtotal: 1500_00 } },
};

// rules: { discountType, value, maxDiscount, minSubtotal, serviceIds }; serviceStatus: Map id -> 'active' | 'disabled'.
// Returns [{ field, message }]; empty = fine.
export function checkRules(rules, serviceStatus) {
  const problems = [];
  const problem = (field, message) => problems.push({ field, message });
  const whole = (n) => Number.isInteger(n);

  if (rules.discountType === 'PERCENT') {
    if (!whole(rules.value) || rules.value <= 0 || rules.value > 10000) problem('value', 'The percentage must be more than 0 and at most 100');
    if (!whole(rules.maxDiscount) || rules.maxDiscount <= 0) problem('maxDiscount', 'Enter the most the offer can take off');
    else if (rules.maxDiscount > MAX_DISCOUNT_CAP) problem('maxDiscount', 'The maximum can be at most ₹1,00,000');
  } else if (rules.discountType === 'FLAT') {
    if (!whole(rules.value) || rules.value <= 0) problem('value', 'The amount off must be more than ₹0');
  } else {
    problem('discountType', 'Choose % off or ₹ off');
  }
  if (!whole(rules.minSubtotal ?? 0) || (rules.minSubtotal ?? 0) < 0) problem('minSubtotal', 'The minimum spend can’t be negative');

  const ids = (rules.serviceIds ?? []).map(String);
  if (new Set(ids).size !== ids.length) problem('serviceIds', 'A service is listed twice');
  if (ids.some((id) => !serviceStatus.has(id))) problem('serviceIds', 'A chosen service was not found');
  if (!ids.some((id) => serviceStatus.get(id) === 'active')) problem('serviceIds', 'Choose at least one active service');
  return problems;
}

// What we save: only the fields that belong to the type, with a cap only for %
export function cleanRules(rules) {
  return {
    discountType: rules.discountType,
    value: rules.value,
    maxDiscount: rules.discountType === 'PERCENT' ? rules.maxDiscount : null,
    minSubtotal: rules.minSubtotal ?? 0,
    serviceIds: (rules.serviceIds ?? []).map(String),
  };
}

export function sameRules(a, b) {
  if (!a || !b) return !a && !b;
  const x = cleanRules(a);
  const y = cleanRules(b);
  return x.discountType === y.discountType && x.value === y.value && x.maxDiscount === y.maxDiscount && x.minSubtotal === y.minSubtotal && [...x.serviceIds].sort().join() === [...y.serviceIds].sort().join();
}

// "15% off (max ₹500)", "₹300 off on ₹1,500+"
export function describeOffer(rules) {
  if (!rules) return '';
  const off = rules.discountType === 'PERCENT' ? `${rules.value / 100}% off (max ${formatAmount(rules.maxDiscount)})` : `${formatAmount(rules.value)} off`;
  return rules.minSubtotal > 0 ? `${off} on ${formatAmount(rules.minSubtotal)}+` : off;
}
