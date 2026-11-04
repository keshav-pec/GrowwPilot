import { PassThrough } from 'node:stream';
import { Customer, EmailOutbox, Invoice, Organization } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { mailMode } from '../mail/config.js';
import { escapeHtml, layout, textToHtml } from '../mail/html.js';
import { maskEmail } from '../../utils/mask.js';
import { kickMailer, onAttachment, queueEmail } from '../mail/outbox.js';
import { loadInvoice, present } from './invoices.service.js';
import { invoicePdfName, writeInvoicePdf } from './invoice.pdf.js';

// "Email bill": the issued bill as a PDF, to the customer's email (or one typed in).
// The PDF isn't stored: it is made again from the bill when the email goes out (phone partly hidden, as on a
// shared link). Emails with a PDF go by SMTP first, then the Apps Script.

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/invoices/:id/email — { to? }. Front desk for their branch, owners for theirs (loadInvoice checks).
export async function emailBill(ctx, id, { to }, key) {
  const invoice = await loadInvoice(ctx, id); // another salon's or branch's bill: not found
  if (mailMode() === 'off') throw new AppError(409, 'MAIL_OFF', 'Email is off. Use Send to customer to share a link instead.');
  if (invoice.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can be emailed');
  const customer = invoice.customerId ? await Customer.findOne(scoped(ctx, { _id: invoice.customerId })).select('name email').lean() : null;
  const address = String(to ?? customer?.email ?? '').trim().toLowerCase();
  if (!address) throw new AppError(400, 'NO_EMAIL', 'This customer has no email address. Type one in.');
  if (!EMAIL.test(address)) throw new AppError(400, 'VALIDATION_ERROR', 'Enter a valid email', [{ field: 'body.to', message: 'Enter a valid email' }]);

  const result = await runOnce(ctx, { key, operation: 'billing.bill.email' }, async (session) => {
    const org = await Organization.findById(ctx.orgId).select('name contactEmail contactPhone').session(session).lean();
    const name = invoice.customerSnapshot?.name ?? customer?.name ?? 'there';
    const text = `Hi ${name.split(' ')[0]},\n\nThank you for visiting ${org.name}. Your bill ${invoice.invoiceNumber} for ${formatMoney(invoice.grandTotal)} is attached as a PDF.${org.contactPhone ? `\n\nQuestions? Call us on ${org.contactPhone} or reply to this email.` : '\n\nQuestions? Reply to this email.'}`;
    const queued = await queueEmail(
      ctx,
      {
        kind: 'BILL',
        dedupeKey: `bill:${invoice._id}:${key}`,
        branchId: invoice.branchId,
        to: address,
        subject: `Your bill ${invoice.invoiceNumber} from ${org.name}`,
        text,
        html: layout({ salonName: org.name, body: textToHtml(text), footer: `${escapeHtml(org.name)} · sent because you visited us.` }),
        fromName: org.name,
        replyTo: org.contactEmail,
        attachment: { type: 'INVOICE', id: invoice._id },
        ref: { invoiceId: invoice._id },
      },
      session
    );
    await logActivity(ctx, { action: 'billing.bill_emailed', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Emailed bill ${invoice.invoiceNumber} to ${maskEmail(address)}` }, session);
    return { id: queued.id, to: maskEmail(address), status: queued.status };
  });
  kickMailer();
  return result;
}

// GET /api/invoices/:id/emails — the bill's emails, newest first (for "Queued / Sent / Not sent" on the bill page)
export async function billEmails(ctx, id) {
  const invoice = await loadInvoice(ctx, id);
  const rows = await EmailOutbox.find(scoped(ctx, { kind: 'BILL', 'ref.invoiceId': invoice._id })).select('to status lastError createdAt sentAt createdBy').sort({ createdAt: -1 }).limit(10).lean();
  const customer = invoice.customerId ? await Customer.findOne(scoped(ctx, { _id: invoice.customerId })).select('email').lean() : null;
  return {
    customerEmail: customer?.email ? maskEmail(customer.email) : null, // the default "to"
    canEmail: mailMode() !== 'off' && invoice.status === 'ISSUED',
    emails: rows.map((r) => ({ _id: r._id, to: maskEmail(r.to), status: r.status, error: r.lastError ?? null, createdAt: r.createdAt, sentAt: r.sentAt ?? null, by: r.createdBy?.name ?? null })),
  };
}

// The PDF, made when the email goes out
async function invoicePdfBuffer(row) {
  const invoice = await Invoice.findOne({ _id: row.attachment.id, orgId: row.orgId }).lean();
  if (!invoice) throw new Error('The bill no longer exists');
  const shown = await present({ orgId: String(row.orgId), role: 'PUBLIC', allowedBranchIds: [String(invoice.branchId)] }, invoice);
  const stream = new PassThrough();
  const chunks = [];
  stream.on('data', (chunk) => chunks.push(chunk));
  const done = new Promise((resolve, reject) => {
    stream.on('end', resolve);
    stream.on('error', reject);
  });
  writeInvoicePdf(stream, shown, { maskPhone: true });
  await done;
  return { fileName: invoicePdfName(shown), mimeType: 'application/pdf', content: Buffer.concat(chunks) };
}

onAttachment('INVOICE', invoicePdfBuffer);
