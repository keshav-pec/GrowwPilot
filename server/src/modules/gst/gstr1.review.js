// The review copy of a GSTR-1, for an owner or accountant: a CSV with every row, and a short PDF.
import PDFDocument from 'pdfkit';
import { BROWN, MUTED, pdfMoney as money, pdfRow } from '../../utils/pdf.js';
import { GST_STATES } from '../../config/billing.js';

const rate = (bps) => `${bps / 100}%`;
const place = (pos, supply) => `${GST_STATES[pos] ?? pos}, ${supply === 'INTER' ? 'another state' : 'same state'}`;
const COLUMNS = [
  { key: 'table', label: 'Table' },
  { key: 'who', label: 'Customer or state' },
  { key: 'number', label: 'Number' },
  { key: 'date', label: 'Date' },
  { key: 'rate', label: 'Rate' },
  { key: 'code', label: 'SAC or HSN' },
  { key: 'unit', label: 'Unit' },
  { key: 'qty', label: 'Qty' },
  { key: 'taxable', label: 'Taxable', money: true },
  { key: 'cgst', label: 'CGST', money: true },
  { key: 'sgst', label: 'SGST', money: true },
  { key: 'igst', label: 'IGST', money: true },
];

// Every row of the return, each with `row`: the key of its figure, to open the entries behind it
export function reviewRows(tables) {
  const rows = [];
  const items = (table, prefix, who, doc) => doc.items.forEach((i) => rows.push({ table, row: `${prefix}:${doc.number}`, who, number: doc.number, date: doc.date, rate: rate(i.rateBps), taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst }));
  for (const g of tables.b2b) g.invoices.forEach((inv) => items('4A B2B', 'b2b', `${g.legalName ?? ''} ${g.ctin}`, inv));
  for (const g of tables.b2cl) g.invoices.forEach((inv) => items('5 B2C large', 'b2cl', GST_STATES[g.pos] ?? g.pos, inv));
  for (const r of tables.b2cs) rows.push({ table: '7 B2C others', row: `b2cs:${r.pos}|${r.rateBps}|${r.supply}`, who: place(r.pos, r.supply), rate: rate(r.rateBps), taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst });
  for (const g of tables.cdnr) g.notes.forEach((n) => items('9B Credit notes (registered)', 'cdnr', `${g.legalName ?? ''} ${g.ctin}`, n));
  tables.cdnur.forEach((n) => items('9B Credit notes (unregistered)', 'cdnur', GST_STATES[n.pos] ?? n.pos, n));
  const advance = (table, prefix, r) => r.items.forEach((i) => rows.push({ table, row: `${prefix}:${r.pos}|${r.supply}`, who: place(r.pos, r.supply), rate: rate(i.rateBps), taxable: i.taxable, cgst: i.cgst, sgst: i.sgst, igst: i.igst }));
  for (const r of tables.at) advance('11A Advances received', 'at', r);
  for (const r of tables.txpd) advance('11B Advances adjusted', 'txpd', r);
  const hsn = (table, r) => rows.push({ table, row: `hsn:${r.section}|${r.code}|${r.rateBps}|${r.unit}`, code: r.code, unit: r.unit, qty: r.qty, rate: rate(r.rateBps), who: r.description, taxable: r.taxable, cgst: r.cgst, sgst: r.sgst, igst: r.igst });
  tables.hsnB2b.forEach((r) => hsn('12 HSN/SAC B2B', r));
  tables.hsnB2c.forEach((r) => hsn('12 HSN/SAC B2C', r));
  const docWords = { 1: 'Invoices', 5: 'Credit notes', 6: 'Receipt vouchers', 8: 'Refund vouchers' };
  for (const d of tables.documents) for (const s of d.series) rows.push({ table: '13 Documents', row: `documents:${d.kind}`, who: docWords[d.kind], number: `${s.from} to ${s.to}`, qty: `${s.total} issued, ${s.cancelled} cancelled` });
  return rows;
}

export const reviewCsv = (found) => ({ columns: COLUMNS, rows: reviewRows(found.tables) });

const STATUS = { NEEDS_FIXING: 'Needs fixing', READY: 'Ready to approve', APPROVED: 'Approved', EXPORTED: 'Exported, not filed', REJECTED: 'Rejected by the portal', FILED: 'Filed (manually confirmed)' };

export function writeReviewPdf(stream, found) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `GSTR-1 review ${found.period}` } });
  doc.pipe(stream);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  doc.font('Helvetica-Bold').fontSize(16).fillColor(BROWN).text('GSTR-1 review copy', left);
  doc.font('Helvetica').fontSize(10).fillColor('black').text(`${found.legalName ?? ''} · GSTIN ${found.gstin}`);
  doc.fillColor(MUTED).fontSize(9).text(`${found.period} · revision ${found.revision} · ${STATUS[found.status]}. This is not a filing.`);
  doc.moveDown(1);

  const columns = [{ width: width - 280 }, { width: 70, align: 'right' }, { width: 70, align: 'right' }, { width: 70, align: 'right' }, { width: 70, align: 'right' }];
  pdfRow(doc, columns, ['Table', 'Taxable', 'CGST', 'SGST', 'IGST'], { bold: true, color: MUTED });
  const sums = new Map();
  for (const r of reviewRows(found.tables)) {
    if (r.taxable === undefined) continue;
    const s = sums.get(r.table) ?? { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
    for (const key of Object.keys(s)) s[key] += r[key] ?? 0;
    sums.set(r.table, s);
  }
  for (const [table, s] of sums) pdfRow(doc, columns, [table, money(s.taxable), money(s.cgst), money(s.sgst), money(s.igst)]);
  doc.moveDown(0.6);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(BROWN).text(`Net taxable ${money(found.totals.taxable)} · Net tax ${money(found.totals.tax)}`, left);
  doc.moveDown(1);

  const documents = reviewRows(found.tables).filter((r) => r.table === '13 Documents');
  if (documents.length > 0) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Documents (Table 13)', left);
    for (const d of documents) doc.font('Helvetica').fontSize(9).fillColor('black').text(`${d.who}: ${d.number}, ${d.qty}`);
    doc.moveDown(1);
  }
  if (found.excluded.length > 0) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Left out of the tables', left);
    for (const e of found.excluded) doc.font('Helvetica').fontSize(9).fillColor('black').text(`${e.documentNumber}: ${e.reason}`);
    doc.moveDown(1);
  }
  const notes = found.issues ?? [];
  if (notes.length > 0) {
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Notes', left);
    for (const n of notes) doc.font('Helvetica').fontSize(9).fillColor('black').text(`${n.severity === 'BLOCKER' ? 'To fix' : 'Check'}: ${n.message}`);
  }
  if (found.filing?.arn) {
    doc.moveDown(1);
    doc.font('Helvetica').fontSize(9).fillColor('black').text(`ARN ${found.filing.arn}, filed on ${found.filing.filedOn}, manually confirmed by ${found.filing.recordedByName}.`, left);
  }
  doc.end();
}
