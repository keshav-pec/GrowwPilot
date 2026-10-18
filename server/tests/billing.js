// Shared steps for tests that need bills.
import { issueInvoice, openDraft, quoteDraft } from '../src/modules/invoices/invoices.service.js';

let n = 0;
export const key = () => `test-key-${Date.now()}-${++n}`;

// Checkout like the screen does: open the draft, apply the discount, issue it.
// payments: defaults to the whole bill in cash
export async function checkout(ctx, appointment, { billDiscount, lines, payments } = {}) {
  const draft = await openDraft(ctx, { appointmentId: appointment._id });
  const edits = { billDiscount, lines };
  const priced = await quoteDraft(ctx, draft._id, edits);
  return issueInvoice(ctx, draft._id, { version: draft.version, ...edits, payments: payments ?? (priced.grandTotal ? [{ method: 'CASH', amount: priced.grandTotal }] : []) }, key());
}
