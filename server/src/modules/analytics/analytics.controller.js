import { DateTime } from 'luxon';
import { getAnalytics, getSalonName } from './analytics.service.js';
import { pdfFileName, writeSalesPdf } from './analytics.pdf.js';

export async function get(req, res) {
  res.json(await getAnalytics(req.ctx, req.valid.query));
}

// Same numbers as the screen, as a downloadable, timestamped PDF
export async function exportPdf(req, res) {
  const data = await getAnalytics(req.ctx, req.valid.query);
  const salonName = await getSalonName(req.ctx);
  // Time stamp in the (first) branch's timezone, e.g. "28 Sep 2026, 4:05 PM IST".
  // The en-IN locale is only used for the zone name, because it gives "IST" instead of "GMT+5:30".
  const now = DateTime.now().setZone(data.branches[0].timezone);
  const stamp = `${now.toFormat('d LLL yyyy, h:mm a')} ${now.setLocale('en-IN').toFormat('ZZZZ')}`;

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${pdfFileName(salonName, now)}"`);
  writeSalesPdf(res, { data, salonName, stamp });
}
