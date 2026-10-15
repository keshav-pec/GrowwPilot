import Papa from 'papaparse';

// The spreadsheet (CSV) import: the columns, a template, a filled-in example, and reading a file.
// The server checks every row again; this only reads the file and catches the obvious problems early.

export const MAX_IMPORT_ROWS = 2000;
export const REQUIRED_COLUMNS = ['name', 'category', 'stock_unit', 'way_of_use'];
export const IMPORT_COLUMNS = [
  ...REQUIRED_COLUMNS,
  'opening_qty',
  'sku_code',
  'brand',
  'barcode',
  'type',
  'base_unit',
  'units_per_stock_unit',
  'reorder_point',
  'reorder_qty',
  'unit_cost',
];

// What each column means (shown next to the upload button)
export const COLUMN_HELP = [
  ['name, category, stock_unit, way_of_use', 'Needed for every row. Way of use is FINISH, SERVICE_UNITS, SERVICE_MEASURED or MANUAL.'],
  ['opening_qty', 'What you have now. Leave empty if you don’t know.'],
  ['base_unit, units_per_stock_unit', 'Only for SERVICE_MEASURED, e.g. ml and 1000. Its quantities are then in ml (3 bottles + 400 ml = 3400).'],
  ['unit_cost', 'Price per stock unit in ₹, owners only. Leave empty if you don’t know.'],
  ['sku_code, brand, barcode, type, reorder_point, reorder_qty', 'Optional. A code is made automatically when sku_code is empty.'],
];

const EXAMPLE_ROWS = [
  { name: 'Loreal Shampoo 1L', category: 'Hair care', stock_unit: 'bottle', way_of_use: 'FINISH', opening_qty: '12', brand: 'Loreal', barcode: '8901030703461', reorder_point: '4', reorder_qty: '12', unit_cost: '650' },
  { name: 'Wax jar 800 ml', category: 'Waxing', stock_unit: 'jar', way_of_use: 'FINISH', opening_qty: '5', reorder_point: '2', reorder_qty: '6' },
  { name: 'Gold facial kit', category: 'Skin', stock_unit: 'kit', way_of_use: 'SERVICE_UNITS', opening_qty: '20', type: 'PROFESSIONAL', reorder_point: '5', reorder_qty: '20', unit_cost: '480' },
  { name: 'Developer 6%', category: 'Colour', stock_unit: 'bottle', way_of_use: 'SERVICE_MEASURED', base_unit: 'ml', units_per_stock_unit: '1000', opening_qty: '3400', reorder_point: '2000' },
  { name: 'Disposable towels', category: 'Supplies', stock_unit: 'pack', way_of_use: 'MANUAL', opening_qty: '' },
];

function download(fileName, rows) {
  // The BOM at the start makes Excel read ₹ and other characters correctly
  const csv = '﻿' + Papa.unparse({ fields: IMPORT_COLUMNS, data: rows.map((r) => IMPORT_COLUMNS.map((c) => r[c] ?? '')) });
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}

export const downloadTemplate = () => download('inventory-template.csv', []);
export const downloadExample = () => download('inventory-example.csv', EXAMPLE_ROWS);

// Reads a CSV file in the browser. Column names are matched loosely ("Stock unit" = stock_unit).
// Resolves to { rows } or { problem: 'what is wrong with the file' }.
export function readImportFile(file) {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      complete: ({ data, meta }) => {
        const missing = REQUIRED_COLUMNS.filter((c) => !meta.fields?.includes(c));
        if (missing.length > 0) return resolve({ problem: `The file is missing these columns: ${missing.join(', ')}. Start from the template.` });
        if (data.length === 0) return resolve({ problem: 'The file has no rows.' });
        if (data.length > MAX_IMPORT_ROWS) {
          return resolve({ problem: `The file has ${data.length} rows. Import at most ${MAX_IMPORT_ROWS} at a time by splitting it into parts.` });
        }
        // Keep only the columns we know, as text
        const rows = data.map((r) => Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, String(r[c] ?? '').trim()])));
        resolve({ rows });
      },
      error: () => resolve({ problem: 'This file could not be read. Save it as CSV and try again.' }),
    });
  });
}
