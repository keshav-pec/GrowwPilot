import Papa from 'papaparse';

// Birthday & Anniversary Offers: months, channels and permission words shared by the screens.
// The server checks everything again; these only help the forms.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// February allows 29, so a 29 Feb birthday can be saved
export const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const MONTH_OPTIONS = MONTHS.map((label, i) => ({ value: String(i + 1), label }));
export const dayOptions = (month) => (month ? Array.from({ length: MAX_DAYS[month - 1] }, (_, i) => ({ value: String(i + 1), label: String(i + 1) })) : []);

// { month: 11, day: null } -> "November (day not provided)"; { month: 2, day: 29 } -> "29 February"
export function formatOccasion(date) {
  if (!date?.month) return null;
  return date.day ? `${date.day} ${MONTHS[date.month - 1]}` : `${MONTHS[date.month - 1]} (day not provided)`;
}

// Form values ({ month: '11', day: '' }) <-> what the server takes ({ month: 11, day: null } or null)
export const toDateForm = (date) => ({ month: date?.month ? String(date.month) : '', day: date?.day ? String(date.day) : '' });
export const fromDateForm = ({ month, day }) => (month ? { month: Number(month), day: day ? Number(day) : null } : null);

export const CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL'];
export const CHANNEL_LABEL = { WHATSAPP: 'WhatsApp', SMS: 'SMS', EMAIL: 'Email' };

export const CONSENT_STATUS = {
  OPTED_IN: { label: 'Opted in', tone: 'gold' },
  UNKNOWN: { label: 'Not recorded', tone: 'neutral' },
  OPTED_OUT: { label: 'Opted out', tone: 'danger' },
};

// How the customer gave (or withdrew) permission
export const CONSENT_SOURCES = [
  { value: 'CUSTOMER_FORM', label: 'Customer form' },
  { value: 'IN_SALON', label: 'In salon' },
  { value: 'CUSTOMER_REQUEST', label: 'Customer request' },
];
export const CONSENT_SOURCE_LABEL = { ...Object.fromEntries(CONSENT_SOURCES.map((s) => [s.value, s.label])), DATA_REMOVAL: 'Occasion data removed' };

export const DATE_SOURCE_LABEL = { CUSTOMER: 'From the customer', STAFF: 'Added by staff', IMPORTED: 'Imported', MIGRATED: 'From the old date of birth' };

// The date import: columns, and reading the filled-in template in the browser
export const MAX_IMPORT_ROWS = 5000;
export const IMPORT_COLUMNS = ['customer_id', 'name', 'phone', 'birthday_month', 'birthday_day', 'anniversary_month', 'anniversary_day'];

// Resolves to { rows } or { problem: 'what is wrong with the file' }
export function readDatesFile(file) {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      complete: ({ data, meta }) => {
        if (!meta.fields?.includes('customer_id')) return resolve({ problem: 'The file has no customer_id column. Start from the downloaded template.' });
        if (data.length === 0) return resolve({ problem: 'The file has no rows.' });
        if (data.length > MAX_IMPORT_ROWS) return resolve({ problem: `The file has ${data.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time.` });
        resolve({ rows: data.map((r) => Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, String(r[c] ?? '').trim()]))) });
      },
      error: () => resolve({ problem: 'This file could not be read. Save it as CSV and try again.' }),
    });
  });
}

// The rejected rows as a CSV to fix and upload again
export function downloadRejected(rejected) {
  const fields = ['row', 'reason', ...IMPORT_COLUMNS];
  const csv = '﻿' + Papa.unparse({ fields, data: rejected.map((r) => fields.map((c) => r[c] ?? '')) });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  link.download = 'occasion-import-rejected.csv';
  link.click();
  URL.revokeObjectURL(link.href);
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------
export const OCCASION_LABEL = { BIRTHDAY: 'Birthday', ANNIVERSARY: 'Anniversary' };
export const CAMPAIGN_STATUS = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  PUBLISHED: { label: 'Live', tone: 'gold' },
  DISABLED: { label: 'Turned off', tone: 'orange' },
  ARCHIVED: { label: 'Archived', tone: 'brown' },
};
export const DELIVERY_LABEL = { STAFF_ASSISTED: 'Staff sends offers' };

const rupees = (paise) => (paise == null ? '' : String(paise / 100));

// Saved terms -> form text. PERCENT value is basis points (1500 -> "15"); money is paise (50000 -> "500").
export function toRulesForm(rules, allServiceIds = []) {
  return {
    discountType: rules?.discountType ?? 'PERCENT',
    value: rules ? (rules.discountType === 'PERCENT' ? String(rules.value / 100) : rupees(rules.value)) : '',
    maxDiscount: rupees(rules?.maxDiscount),
    minSubtotal: rupees(rules?.minSubtotal ?? 0),
    serviceIds: rules?.serviceIds?.map(String) ?? allServiceIds,
  };
}

const amount = (text) => /^\d+(\.\d{1,2})?$/.test(String(text).trim());
const toPaise = (text) => Math.round(Number(text) * 100);

export function fromRulesForm(form) {
  const percent = form.discountType === 'PERCENT';
  return {
    discountType: form.discountType,
    value: toPaise(form.value), // % x 100 = basis points; ₹ x 100 = paise
    maxDiscount: percent ? toPaise(form.maxDiscount) : null,
    minSubtotal: toPaise(form.minSubtotal || 0),
    serviceIds: form.serviceIds,
  };
}

// Same checks as the server, so the form can show them before saving. { field: message }
export function rulesFormErrors(form, activeServiceIds) {
  const errors = {};
  if (form.discountType === 'PERCENT') {
    if (!amount(form.value) || Number(form.value) <= 0 || Number(form.value) > 100) errors.value = 'More than 0 and at most 100';
    if (!amount(form.maxDiscount) || Number(form.maxDiscount) <= 0) errors.maxDiscount = 'Needed for a % offer';
    else if (Number(form.maxDiscount) > 100000) errors.maxDiscount = 'At most ₹1,00,000';
  } else if (!amount(form.value) || Number(form.value) <= 0) {
    errors.value = 'More than ₹0';
  }
  if (form.minSubtotal !== '' && !amount(form.minSubtotal)) errors.minSubtotal = 'An amount in ₹, or 0';
  if (!form.serviceIds.some((id) => activeServiceIds.includes(id))) errors.serviceIds = 'Choose at least one service';
  return errors;
}

// "15% off (max ₹500)", "₹300 off on ₹1,500+" (the server sends the same words for saved campaigns)
export function describeOffer(rules) {
  if (!rules) return '';
  const money = (paise) => new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: paise % 100 ? 2 : 0, minimumFractionDigits: paise % 100 ? 2 : 0 }).format(paise / 100);
  const off = rules.discountType === 'PERCENT' ? `${rules.value / 100}% off (max ${money(rules.maxDiscount)})` : `${money(rules.value)} off`;
  return rules.minSubtotal > 0 ? `${off} on ${money(rules.minSubtotal)}+` : off;
}
