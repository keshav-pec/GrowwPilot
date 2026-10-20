// A report table ({ columns: [{ key, label, money? }], rows }) as CSV text: money columns in rupees (1530.50),
// everything else as it is. Excel opens it correctly when sent with a BOM (see the report routes).
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
