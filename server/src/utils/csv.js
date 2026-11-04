// A report table ({ columns: [{ key, label, money? }], rows }) as CSV text: money columns in rupees (1530.50),
// everything else as it is.
export function toCsv(report) {
  const cell = (value) => {
    if (value == null) return '';
    const text = String(value);
    return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
  };
  const header = report.columns.map((c) => cell(c.label)).join(',');
  const lines = report.rows.map((row) => report.columns.map((c) => cell(c.money && row[c.key] != null ? (row[c.key] / 100).toFixed(2) : row[c.key])).join(','));
  return [header, ...lines].join('\n');
}

// Sends a report table as a CSV download. The BOM at the start makes Excel read it correctly.
export function sendCsv(res, fileName, report) {
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(`\uFEFF${toCsv(report)}`);
}
