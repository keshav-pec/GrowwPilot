// Fixed lists and small helpers for billing (BILLING_PLAN.md).
import { DateTime } from 'luxon';

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'VOID'];
export const SETTLEMENT_STATUSES = ['UNPAID', 'PARTIALLY_PAID', 'PAID'];
export const REFUND_STATUSES = ['NONE', 'PARTIAL', 'FULL']; // used from Phase 2
export const LINE_KINDS = ['SERVICE', 'PRODUCT']; // PRODUCT lines come in Phase 2
export const APPROVAL_STATUSES = ['NONE', 'PENDING', 'APPROVED', 'REJECTED'];
export const DISCOUNT_TYPES = ['flat', 'percent'];

// GST rates a line can have, in basis points (1800 = 18%)
export const GST_RATES_BPS = [0, 500, 1200, 1800, 2800, 4000];

// GST state codes: the first two digits of a GSTIN
export const GST_STATES = {
  '01': 'Jammu and Kashmir',
  '02': 'Himachal Pradesh',
  '03': 'Punjab',
  '04': 'Chandigarh',
  '05': 'Uttarakhand',
  '06': 'Haryana',
  '07': 'Delhi',
  '08': 'Rajasthan',
  '09': 'Uttar Pradesh',
  '10': 'Bihar',
  '11': 'Sikkim',
  '12': 'Arunachal Pradesh',
  '13': 'Nagaland',
  '14': 'Manipur',
  '15': 'Mizoram',
  '16': 'Tripura',
  '17': 'Meghalaya',
  '18': 'Assam',
  '19': 'West Bengal',
  '20': 'Jharkhand',
  '21': 'Odisha',
  '22': 'Chhattisgarh',
  '23': 'Madhya Pradesh',
  '24': 'Gujarat',
  '26': 'Dadra and Nagar Haveli and Daman and Diu',
  '27': 'Maharashtra',
  '29': 'Karnataka',
  '30': 'Goa',
  '31': 'Lakshadweep',
  '32': 'Kerala',
  '33': 'Tamil Nadu',
  '34': 'Puducherry',
  '35': 'Andaman and Nicobar Islands',
  '36': 'Telangana',
  '37': 'Andhra Pradesh',
  '38': 'Ladakh',
  '97': 'Other Territory',
};

// A GSTIN is 15 characters: state code, PAN, entity number, "Z", check character
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const GSTIN_CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';

// The last character of a GSTIN is worked out from the first 14, which catches most typing mistakes
export function gstinCheckChar(first14) {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(first14[i]) * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36];
}

export function isValidGstin(gstin) {
  return GSTIN_SHAPE.test(gstin) && Boolean(GST_STATES[gstin.slice(0, 2)]) && gstinCheckChar(gstin) === gstin[14];
}

// Bill prefix per branch, e.g. "AND". Numbers look like AND/26-27/00001 (at most 16 characters, a GST rule).
export const PREFIX_REGEX = /^[A-Z0-9]{1,4}$/;

// Indian financial year (1 April to 31 March) of a moment, in the branch's timezone: "26-27"
export function financialYear(date, zone) {
  const local = DateTime.fromJSDate(date, { zone });
  const start = local.month >= 4 ? local.year : local.year - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}

// ("AND", "26-27", 1) -> "AND/26-27/00001"
export function formatInvoiceNumber(prefix, fy, seq) {
  return `${prefix}/${fy}/${String(seq).padStart(5, '0')}`;
}
