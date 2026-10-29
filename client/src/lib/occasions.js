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
