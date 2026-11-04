import Papa from 'papaparse';
import { DateTime } from 'luxon';
import { readCsvFile } from './csv';
import { toPaise } from './money';

// Birthday & Anniversary Offers: months, channels and permission words shared by the screens.
// The server checks everything again; these only help the forms.

export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
// February allows 29, so a 29 Feb birthday can be saved
export const MAX_DAYS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export const MONTH_OPTIONS = MONTHS.map((label, i) => ({ value: String(i + 1), label }));

// This month and the 12 before it, e.g. { value: '2026-11', label: 'November 2026' }. valueOf: how the value is written.
export function monthOptions(zone, valueOf = (d) => d.toFormat('yyyy-MM')) {
  const now = DateTime.now().setZone(zone);
  return Array.from({ length: 13 }, (_, i) => {
    const d = now.minus({ months: i });
    return { value: valueOf(d), label: `${MONTHS[d.month - 1]} ${d.year}` };
  });
}
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
  return readCsvFile(file, {
    columns: IMPORT_COLUMNS,
    maxRows: MAX_IMPORT_ROWS,
    checkColumns: (fields) => (fields.includes('customer_id') ? null : 'The file has no customer_id column. Start from the downloaded template.'),
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
export const DELIVERY_LABEL = { STAFF_ASSISTED: 'Staff sends offers', AUTO_EMAIL: 'Emails automatically' };

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

// ---------------------------------------------------------------------------
// Offers given to customers
// ---------------------------------------------------------------------------
export const OFFER_STATUS = {
  ISSUED: { label: 'Available', tone: 'gold' },
  REDEEMED: { label: 'Used', tone: 'brown' },
  EXPIRED: { label: 'Expired', tone: 'neutral' },
  REVOKED: { label: 'Withdrawn', tone: 'danger' },
  SUPERSEDED: { label: 'Replaced', tone: 'neutral' },
};

// The front desk's step, in plain words
export function taskLabel(offer) {
  const t = offer.task ?? {};
  if (t.state === 'OPEN') return t.kind === 'WITHDRAWN_NOTICE' ? 'Tell customer: withdrawn' : 'To contact';
  if (t.state === 'CONTACTED') return t.sentAutomatically ? 'Emailed automatically' : 'Contacted';
  const reasons = { EXPIRED: 'Closed: expired', REDEEMED: 'Closed: used', WITHDRAWN: 'Closed: withdrawn', REPLACED: 'Closed: date corrected', UNREACHABLE: 'Unreachable' };
  return reasons[t.closedReason] ?? 'Closed';
}

export const OFFER_EVENT_LABEL = {
  ISSUED: 'Offer given',
  ASSIGNED: 'Assigned',
  CONTACT: 'Call recorded',
  SENT: 'Message sent',
  BOOKED: 'Booking linked',
  REDEEMED: 'Used on a bill',
  RESTORED: 'Given back (bill voided)',
  EXPIRED: 'Expired',
  REVOKED: 'Withdrawn',
  SUPERSEDED: 'Replaced (date corrected)',
  MOVED: 'Moved to another branch',
  EMAIL_SENT: 'Email sent',
  EMAIL_FAILED: 'Email not sent',
};

// An offer email sent by the app: waiting to go out, sent, or not sent (the reason is on the task)
export const EMAIL_STATUS = {
  QUEUED: { label: 'Email queued', tone: 'yellow' },
  SENT: { label: 'Email sent', tone: 'gold' },
  FAILED: { label: 'Email not sent', tone: 'danger' },
};

// "Birthday · 5 November", "Anniversary · November"
export const occasionLine = (offer) => `${OCCASION_LABEL[offer.type]} · ${offer.day ? `${offer.day} ` : ''}${MONTHS[offer.month - 1]}`;

// Call outcomes (Record call outcome)
export const CALL_OUTCOMES = [
  { value: 'REACHED', label: 'Reached', hint: 'Spoke to the customer' },
  { value: 'NO_ANSWER', label: 'No answer', hint: 'One follow-up tomorrow at 11:00; a second no answer closes it' },
  { value: 'NOT_INTERESTED', label: 'Not interested', hint: 'Closes the task' },
  { value: 'CALL_LATER', label: 'Call later', hint: 'Pick a time before the offer ends' },
  { value: 'WRONG_DETAILS', label: 'Wrong details', hint: 'Closes the task; fix the number on the profile' },
];
