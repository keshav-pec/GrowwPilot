import Papa from 'papaparse';

// Reads a CSV file in the browser. Column names are matched loosely ("Stock unit" = stock_unit), and only the
// known columns are kept, as text. Resolves to { rows } or { problem: 'what is wrong with the file' }.
// checkColumns(fields) can return a problem with the file's columns.
export function readCsvFile(file, { columns, maxRows, checkColumns }) {
  return new Promise((resolve) => {
    Papa.parse(file, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h) => h.replace(/^﻿/, '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      complete: ({ data, meta }) => {
        const problem = checkColumns(meta.fields ?? []);
        if (problem) return resolve({ problem });
        if (data.length === 0) return resolve({ problem: 'The file has no rows.' });
        if (data.length > maxRows) return resolve({ problem: `The file has ${data.length} rows. Import at most ${maxRows} at a time by splitting it into parts.` });
        resolve({ rows: data.map((r) => Object.fromEntries(columns.map((c) => [c, String(r[c] ?? '').trim()]))) });
      },
      error: () => resolve({ problem: 'This file could not be read. Save it as CSV and try again.' }),
    });
  });
}
