// Builds the sales PDF with pdfkit. The owner downloads it and emails it to the sales team.
import PDFDocument from 'pdfkit';
import { DateTime } from 'luxon';
import { BROWN, MUTED, pdfMoney as money, pdfRow } from '../../utils/pdf.js';

const WEEKDAYS = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const orDash = (value, suffix = '') => (value === null || value === undefined ? '-' : `${value}${suffix}`);

// A simple table: columns [{ header, width, align }], rows = arrays of text
function table(doc, columns, rows) {
  pdfRow(doc, columns, columns.map((c) => c.header), { bold: true, color: MUTED });
  if (rows.length === 0) pdfRow(doc, columns, ['No data for this period'], { color: MUTED });
  for (const row of rows) pdfRow(doc, columns, row);
  doc.moveDown(1);
}

function heading(doc, text) {
  if (doc.y > doc.page.height - 140) doc.addPage();
  doc.x = doc.page.margins.left;
  doc.font('Helvetica-Bold').fontSize(12).fillColor(BROWN).text(text);
  doc.moveDown(0.3);
}

// "GrowwPilot_Sales_Glamour-Studio_2026-09-28_1605.pdf"
export function pdfFileName(salonName, now) {
  const safeName = salonName.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '');
  return `GrowwPilot_Sales_${safeName}_${now.toFormat('yyyy-MM-dd_HHmm')}.pdf`;
}

// Writes the report into `stream` (the HTTP response)
export function writeSalesPdf(stream, { data, salonName, stamp }) {
  const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `${salonName} sales report` } });
  doc.pipe(stream);

  const branchLabel = data.branchId === 'all' ? `All branches (${data.branches.map((b) => b.name).join(', ')})` : data.branches[0].name;
  const range = `${DateTime.fromISO(data.from).toFormat('d LLL yyyy')} to ${DateTime.fromISO(data.to).toFormat('d LLL yyyy')}`;

  // ----- Title block -----
  doc.font('Helvetica-Bold').fontSize(18).fillColor(BROWN).text('GrowwPilot Sales Report');
  doc.font('Helvetica').fontSize(10).fillColor('black').text(`Salon: ${salonName}`).text(`Branch: ${branchLabel}`).text(`Period: ${range}`);
  doc.fillColor(MUTED).text(`Generated on ${stamp}`); // e.g. "Generated on 28 Sep 2026, 4:05 PM IST"
  doc.moveDown(1);

  // ----- Summary -----
  heading(doc, 'Summary');
  table(
    doc,
    [
      { header: 'Revenue', width: 130, align: 'right' },
      { header: 'Bookings', width: 110, align: 'right' },
      { header: 'Invoices', width: 110, align: 'right' },
      { header: 'Average ticket', width: 130, align: 'right' },
    ],
    [[money(data.totals.revenue), data.totals.bookings, data.totals.invoices, money(data.totals.avgTicket)]]
  );

  heading(doc, 'Branch demand');
  table(
    doc,
    [
      { header: 'Branch', width: 160 },
      { header: 'Bookings', width: 90, align: 'right' },
      { header: 'Revenue', width: 120, align: 'right' },
      { header: 'Average ticket', width: 120, align: 'right' },
    ],
    data.branchDemand.map((b) => [b.name, b.bookings, money(b.revenue), money(b.avgTicket)])
  );

  heading(doc, 'Busiest time slots (branch local time)');
  const busiest = [...data.slotDemand.slots].filter((s) => s.count > 0).sort((a, b) => b.count - a.count).slice(0, 8);
  table(
    doc,
    [
      { header: 'Day', width: 120 },
      { header: 'Hour', width: 160 },
      { header: 'Bookings', width: 100, align: 'right' },
    ],
    busiest.map((s) => [WEEKDAYS[s.day], `${DateTime.fromObject({ hour: s.hour }).toFormat('h a')} - ${DateTime.fromObject({ hour: (s.hour + 1) % 24 }).toFormat('h a')}`, s.count])
  );

  heading(doc, 'Stylist demand');
  table(
    doc,
    [
      { header: 'Stylist', width: 150 },
      { header: 'Bookings', width: 80, align: 'right' },
      { header: 'Booked hours', width: 90, align: 'right' },
      { header: 'Utilisation', width: 80, align: 'right' },
      { header: 'Service value', width: 110, align: 'right' },
    ],
    data.stylistDemand.map((s) => [s.name, s.bookings, (s.bookedMinutes / 60).toFixed(1), orDash(s.utilisation, '%'), money(s.serviceValue)])
  );

  heading(doc, 'Top services');
  table(
    doc,
    [
      { header: 'Service', width: 220 },
      { header: 'Bookings', width: 100, align: 'right' },
      { header: 'Service value', width: 140, align: 'right' },
    ],
    data.serviceDemand.slice(0, 10).map((s) => [s.name, s.bookings, money(s.serviceValue)])
  );

  doc.font('Helvetica').fontSize(8).fillColor(MUTED).text('Revenue = net sales: bills issued in the period after discounts and refunds, without GST. Service value = list price of completed services (before discounts and combo prices).');
  doc.end();
}
