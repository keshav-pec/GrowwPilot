import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { sharedInvoice } from './invoices.service.js';
import { invoicePdfName, writeInvoicePdf } from './invoice.pdf.js';

// /api/public — pages anyone with the link may open, without logging in.
// GET /api/public/bills/<token>.pdf  — a bill shared with its customer (the phone number is partly hidden)
const router = Router();
router.use(rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false }));

router.get('/bills/:token.pdf', async (req, res) => {
  const invoice = await sharedInvoice(req.params.token);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${invoicePdfName(invoice)}"`);
  res.setHeader('Cache-Control', 'private, no-store');
  writeInvoicePdf(res, invoice, { maskPhone: true });
});

export default router;
