import { formatMoney } from './money.js';

// What the PDFs (bills, payslips, the sales report) have in common
export const BROWN = '#6B4226';
export const MUTED = '#6B6B6B';
const LINE = '#E5E5E0';

// The built-in PDF fonts have no ₹ sign, so the PDF writes "Rs." instead
export const pdfText = (value) => String(value ?? '').replaceAll('₹', 'Rs. ');
export const pdfMoney = (paise) => pdfText(formatMoney(paise));

// One table row with a line under it. columns: [{ width, align }], cells: the text of each column.
// wrap: long text runs onto more lines and the row grows; otherwise it's cut off with "…".
export function pdfRow(doc, columns, cells, { bold = false, color = 'black', wrap = false, height = 18, pad = 4 } = {}) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
  const left = doc.page.margins.left;
  const y = doc.y;
  let x = left;
  let rowHeight = height;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(color);
  cells.forEach((cell, i) => {
    const { width, align = 'left' } = columns[i];
    doc.text(pdfText(cell), x + 4, y + pad, { width: width - 8, align, ...(wrap ? {} : { lineBreak: false, ellipsis: true }) });
    if (wrap) rowHeight = Math.max(rowHeight, doc.y - y + 4);
    x += width;
  });
  doc.moveTo(left, y + rowHeight).lineTo(x, y + rowHeight).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.y = y + rowHeight;
}
