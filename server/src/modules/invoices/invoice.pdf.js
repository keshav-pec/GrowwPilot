// A bill as a PDF (pdfkit): "Download PDF" on the bill page, and the link shared with the customer.
// The same content as the printable page: seller and GSTIN, customer, lines with discounts and GST,
// the tax table, totals, payments and refunds.
import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { formatMoney } from '../../utils/money.js';

const BROWN = '#6B4226';
const MUTED = '#6B6B6B';
const LINE = '#E5E5E0';
const METHOD = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', OTHER: 'Other', ADVANCE: 'From advance' };

// The built-in PDF fonts have no ₹ sign, so the PDF writes "Rs." instead
const money = (paise) => formatMoney(paise).replace('₹', 'Rs. ');
const percent = (bps) => `${bps / 100}%`;

// "9876543210" -> "98XXXXXX10" (a shared link can be forwarded, so the full number is not printed)
export const maskPhone = (phone) => (phone && phone.length > 4 ? `${phone.slice(0, 2)}${'X'.repeat(phone.length - 4)}${phone.slice(-2)}` : phone);

// "AND/26-27/00001" -> "Bill_AND-26-27-00001.pdf"
export const invoicePdfName = (invoice) => `Bill_${(invoice.invoiceNumber ?? 'draft').replace(/[^a-z0-9]+/gi, '-')}.pdf`;

function row(doc, columns, cells, { bold = false, color = 'black' } = {}) {
  if (doc.y > doc.page.height - doc.page.margins.bottom - 24) doc.addPage();
  const y = doc.y;
  let x = doc.page.margins.left;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9).fillColor(color);
  let height = 18;
  cells.forEach((cell, i) => {
    doc.text(String(cell ?? ''), x + 4, y + 4, { width: columns[i].width - 8, align: columns[i].align ?? 'left' });
    height = Math.max(height, doc.y - y + 4);
    x += columns[i].width;
  });
  doc.moveTo(doc.page.margins.left, y + height).lineTo(x, y + height).strokeColor(LINE).lineWidth(0.5).stroke();
  doc.y = y + height;
}

// A label and an amount on the right-hand side (the totals block)
function total(doc, label, value, { bold = false, color = 'black' } = {}) {
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(color);
  doc.text(label, right - 260, y, { width: 150, align: 'right' });
  doc.text(value, right - 105, y, { width: 105, align: 'right' });
  doc.y = y + (bold ? 16 : 13);
}

// invoice: as the bill page gets it (present() in invoices.service.js). maskPhone: for shared links.
export function writeInvoicePdf(stream, invoice, { maskPhone: mask = false } = {}) {
  const zone = invoice.branchId?.timezone ?? 'Asia/Kolkata';
  const seller = invoice.seller ?? {};
  const gst = invoice.gstRegistered;
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${seller.tradeName ?? 'Bill'} ${invoice.invoiceNumber ?? ''}` } });
  doc.pipe(stream);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  // ----- Seller (left) and bill number (right) -----
  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BROWN).text(seller.tradeName ?? '', left, top, { width: width - 180 });
  doc.font('Helvetica').fontSize(9).fillColor('black');
  if (gst && seller.legalName && seller.legalName !== seller.tradeName) doc.text(seller.legalName, { width: width - 180 });
  doc.fillColor(MUTED).text([seller.branchName ?? invoice.branchId?.name, seller.address].filter(Boolean).join(' · '), { width: width - 180 });
  if (seller.gstin) doc.fillColor('black').text(`GSTIN ${seller.gstin}${seller.stateName ? ` · ${seller.stateName} (${seller.stateCode})` : ''}`, { width: width - 180 });
  const leftBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(gst ? 'TAX INVOICE' : 'BILL', left + width - 170, top, { width: 170, align: 'right' });
  doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text(invoice.invoiceNumber ?? 'Draft', { width: 170, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED);
  if (invoice.issuedAt) doc.text(DateTime.fromJSDate(new Date(invoice.issuedAt), { zone }).toFormat('d LLL yyyy, h:mm a'), { width: 170, align: 'right' });
  if (invoice.status === 'VOID') doc.fillColor('#B42318').text('VOID', { width: 170, align: 'right' });
  doc.y = Math.max(leftBottom, doc.y) + 14;
  doc.x = left;

  // ----- Customer -----
  const customer = invoice.customerSnapshot ?? {};
  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Billed to', left);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(customer.name ?? 'Guest');
  if (customer.phone) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(mask ? maskPhone(customer.phone) : customer.phone);
  doc.moveDown(1);

  // ----- Lines -----
  const columns = gst
    ? [{ width: 175 }, { width: 35, align: 'right' }, { width: 70, align: 'right' }, { width: 65, align: 'right' }, { width: 70, align: 'right' }, { width: 40, align: 'right' }, { width: width - 455, align: 'right' }]
    : [{ width: 255 }, { width: 40, align: 'right' }, { width: 80, align: 'right' }, { width: 80, align: 'right' }, { width: width - 455, align: 'right' }];
  const header = gst ? ['Item', 'Qty', 'Price', 'Discount', 'Taxable', 'GST', 'Amount'] : ['Item', 'Qty', 'Price', 'Discount', 'Amount'];
  row(doc, columns, header, { bold: true, color: MUTED });
  for (const line of invoice.lines) {
    const discount = line.comboDiscount + line.lineDiscount + line.billDiscountShare;
    const code = line.sacCode ? `SAC ${line.sacCode}` : line.hsnCode ? `HSN ${line.hsnCode}` : '';
    const who = line.kind === 'PRODUCT' ? 'Product' : line.staffName;
    const refunded = line.refundedQty > 0 ? ` · ${line.refundedQty === line.qty ? 'refunded' : `${line.refundedQty} refunded`}` : '';
    const name = `${line.name}\n${[who, code].filter(Boolean).join(' · ')}${refunded}`;
    const cells = [name, line.qty, money(line.unitPrice * line.qty), discount > 0 ? `-${money(discount)}` : '-'];
    row(doc, columns, gst ? [...cells, money(line.taxableAmount), percent(line.taxRateBps), money(line.lineTotal)] : [...cells, money(line.lineTotal)]);
  }
  doc.moveDown(0.8);

  // ----- Totals -----
  total(doc, 'Subtotal', money(invoice.subtotal));
  if (invoice.discountTotal > 0) total(doc, 'Discounts', `-${money(invoice.discountTotal)}`, { color: MUTED });
  if (gst) {
    total(doc, 'Taxable value', money(invoice.taxableTotal), { color: MUTED });
    for (const t of invoice.taxSummary ?? []) {
      total(doc, `CGST ${percent(t.rateBps / 2)}`, money(t.cgst), { color: MUTED });
      total(doc, `SGST ${percent(t.rateBps / 2)}`, money(t.sgst), { color: MUTED });
    }
  }
  total(doc, 'Total', money(invoice.grandTotal), { bold: true, color: BROWN });
  if (invoice.creditedTotal > 0) total(doc, 'Refunded items', `-${money(invoice.creditedTotal)}`, { color: MUTED });
  if (invoice.amountPaid > 0) total(doc, 'Paid', money(invoice.amountPaid));
  if (invoice.refundedTotal > 0) total(doc, 'Given back', `-${money(invoice.refundedTotal)}`, { color: MUTED });
  if (invoice.status === 'ISSUED' && invoice.balanceDue > 0) total(doc, 'Balance due', money(invoice.balanceDue), { bold: true, color: '#B54708' });
  if (gst) {
    doc.font('Helvetica').fontSize(8).fillColor(MUTED).text(invoice.pricesIncludeTax ? 'Prices include GST.' : 'GST added on top of the prices.', left, doc.y + 2, { width, align: 'right' });
  }

  // ----- Payments -----
  const payments = (invoice.payments ?? []).filter((p) => p.status !== 'REVERSED');
  if (payments.length > 0) {
    doc.moveDown(1);
    doc.x = left;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Payments');
    for (const p of payments) {
      const when = DateTime.fromJSDate(new Date(p.receivedAt), { zone }).toFormat('d LLL yyyy');
      doc.font('Helvetica').fontSize(9).fillColor('black').text(`${p.label ?? METHOD[p.method] ?? p.method}${p.reference ? ` (${p.reference})` : ''} · ${when}: ${money(p.amount)}`);
    }
  }
  const refunds = (invoice.refunds ?? []).filter((r) => r.status === 'DONE');
  if (refunds.length > 0) {
    doc.moveDown(0.6);
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Refunds');
    for (const r of refunds) {
      doc.font('Helvetica').fontSize(9).fillColor('black').text(`${r.creditNoteNumber ? `Credit note ${r.creditNoteNumber}: ` : ''}${r.lines.map((l) => `${l.qty} x ${l.name}`).join(', ')} · ${money(r.creditTotal)}`);
    }
  }

  doc.moveDown(2);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Thank you for visiting ${seller.tradeName ?? 'us'}!`, left, doc.y, { width, align: 'center' });
  doc.end();
}
