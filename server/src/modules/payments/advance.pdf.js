// A receipt voucher as a PDF (pdfkit), with any refund vouchers on it. A plain advance gets a simple receipt.
import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { BROWN, MUTED, pdfMoney as money, pdfRow } from '../../utils/pdf.js';

const percent = (bps) => `${bps / 100}%`;

// "RV-AND/26-27/001" -> "Receipt_RV-AND-26-27-001.pdf"
export const advancePdfName = (advance) => `Receipt_${(advance.receiptNumber ?? String(advance._id)).replace(/[^a-z0-9]+/gi, '-')}.pdf`;

function amountRow(doc, label, value, { bold = false } = {}) {
  const right = doc.page.width - doc.page.margins.right;
  const y = doc.y;
  doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(bold ? 11 : 9).fillColor(bold ? BROWN : MUTED);
  doc.text(label, right - 260, y, { width: 150, align: 'right' });
  doc.text(value, right - 105, y, { width: 105, align: 'right' });
  doc.y = y + (bold ? 16 : 13);
}

export function writeAdvancePdf(stream, { advance, branch, customer }) {
  const zone = branch?.timezone ?? 'Asia/Kolkata';
  const g = advance.gst ?? {};
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Receipt ${advance.receiptNumber ?? ''}` } });
  doc.pipe(stream);
  const left = doc.page.margins.left;
  const width = doc.page.width - left - doc.page.margins.right;

  const top = doc.y;
  doc.font('Helvetica-Bold').fontSize(16).fillColor(BROWN).text(g.tradeName ?? branch?.name ?? '', left, top, { width: width - 180 });
  doc.font('Helvetica').fontSize(9).fillColor('black');
  if (g.legalName && g.legalName !== g.tradeName) doc.text(g.legalName, { width: width - 180 });
  doc.fillColor(MUTED).text([g.branchName ?? branch?.name, g.address].filter(Boolean).join(' · '), { width: width - 180 });
  if (g.gstin) doc.fillColor('black').text(`GSTIN ${g.gstin} · ${g.stateName} (${g.stateCode})`, { width: width - 180 });
  const leftBottom = doc.y;

  doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text(advance.taxed ? 'RECEIPT VOUCHER' : 'ADVANCE RECEIPT', left + width - 170, top, { width: 170, align: 'right' });
  if (advance.receiptNumber) doc.font('Helvetica-Bold').fontSize(11).fillColor('black').text(advance.receiptNumber, { width: 170, align: 'right' });
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(DateTime.fromJSDate(new Date(advance.createdAt), { zone }).toFormat('d LLL yyyy, h:mm a'), { width: 170, align: 'right' });
  doc.y = Math.max(leftBottom, doc.y) + 14;
  doc.x = left;

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Received from', left);
  doc.font('Helvetica-Bold').fontSize(10).fillColor('black').text(g.customerName ?? customer?.name ?? '');
  if (g.buyer?.gstin) doc.font('Helvetica').fontSize(9).fillColor('black').text(`${g.buyer.legalName ?? ''} · GSTIN ${g.buyer.gstin}`);
  if (g.placeOfSupply?.stateCode) doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(`Place of supply: ${g.placeOfSupply.stateName} (${g.placeOfSupply.stateCode})`);
  doc.moveDown(1);

  const description = advance.forServices?.length ? `Advance for ${advance.forServices.map((f) => f.name).join(', ')}` : 'Advance';
  if (advance.taxed) {
    const columns = [{ width: width - 245 }, { width: 80, align: 'right' }, { width: 85, align: 'right' }, { width: 80, align: 'right' }];
    pdfRow(doc, columns, ['Item', 'Taxable', 'GST', 'Amount'], { bold: true, color: MUTED, wrap: true });
    pdfRow(doc, columns, [`${description}\nSAC ${g.code}${advance.note ? ` · ${advance.note}` : ''}`, money(g.taxable), percent(g.rateBps), money(advance.amount)], { wrap: true });
    doc.moveDown(0.8);
    amountRow(doc, 'Taxable value', money(g.taxable));
    if (g.igst) {
      amountRow(doc, `IGST ${percent(g.rateBps)}`, money(g.igst));
    } else {
      amountRow(doc, `CGST ${percent(g.rateBps / 2)}`, money(g.cgst));
      amountRow(doc, `SGST ${percent(g.rateBps / 2)}`, money(g.sgst));
    }
  } else {
    doc.font('Helvetica').fontSize(10).fillColor('black').text(`${description}${advance.note ? ` · ${advance.note}` : ''}`, left);
    doc.moveDown(0.8);
  }
  amountRow(doc, 'Received', money(advance.amount), { bold: true });

  if (advance.refunds?.length) {
    doc.moveDown(1);
    doc.x = left;
    doc.font('Helvetica-Bold').fontSize(9).fillColor(MUTED).text('Given back');
    for (const r of advance.refunds) {
      const when = DateTime.fromJSDate(new Date(r.at), { zone }).toFormat('d LLL yyyy');
      doc.font('Helvetica').fontSize(9).fillColor('black').text(`${r.number ? `Refund voucher ${r.number} · ` : ''}${when}: ${money(r.amount)}${advance.taxed ? `, including ${money(r.cgst + r.sgst + r.igst)} GST` : ''}. ${r.reason}`);
    }
  }
  doc.moveDown(2);
  doc.font('Helvetica').fontSize(9).fillColor(MUTED).text(advance.taxed ? 'GST on this money has been charged here, so it is not charged again when the money is used on a bill.' : 'This money can be used on later bills.', left, doc.y, { width, align: 'center' });
  doc.end();
}
