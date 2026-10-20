import { Branch, Counter, CreditNote, InventoryLocation, Invoice, Payment, Refund, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { financialYear, formatCreditNoteNumber } from '../../config/billing.js';
import { logActivity } from '../activity/activity.service.js';
import { notify } from '../notifications/notifications.service.js';
import { markPayrollStale } from '../payroll/payrollStale.js';
import { reverseCommissions } from '../payroll/commission.service.js';
import { creditForLine, moneyState } from '../billing/tax.rules.js';
import { billingPermissions, branchBilling, getBillingSettings } from '../billing/settings.service.js';
import { loadInvoice, present } from '../invoices/invoices.service.js';
import { settle } from '../payments/allocations.js';
import { postMovement } from '../inventory/stock/stock.engine.js';

// ---------------------------------------------------------------------------
// Refunds and returns on an issued bill (BILLING_PLAN.md, Phase 2).
//   - Pick lines and how many; for products, say if they can be sold again (SELLABLE) or are DAMAGED.
//   - The front desk can only ask (REQUESTED, owners get the bell). An owner who may approve refunds does it
//     straight away; approving does everything in one transaction:
//       the bill's value goes down by the refunded lines (with their GST),
//       money paid beyond the new value goes back to the customer (a REFUND payment), the rest lowers what is owed,
//       a GST bill gets a credit note (CN-AND/26-27/001),
//       sellable products go back into the main store, damaged ones are written off,
//       commission on refunded services is taken back.
// ---------------------------------------------------------------------------

const LINK = (invoiceId) => `/app/invoices/${invoiceId}`;
const MONEY = (refund) => (refund.cashRefund > 0 ? `${formatMoney(refund.cashRefund)} back by ${refund.method.toLowerCase()}` : 'nothing to hand back');

// What a refund of these lines would do to the bill right now.
// requested: [{ lineId, qty, restock }] -> { lines (with amounts), creditTotal, cashRefund, dueReduced }
export function planRefund(invoice, requested) {
  if (requested.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Choose what is being refunded');
  const seen = new Set();
  const lines = requested.map((r) => {
    const line = invoice.lines.find((l) => String(l._id) === String(r.lineId));
    if (!line) throw new AppError(400, 'VALIDATION_ERROR', 'That line is not on this bill');
    if (seen.has(String(line._id))) throw new AppError(400, 'VALIDATION_ERROR', `${line.name} is listed twice`);
    seen.add(String(line._id));
    if (line.kind === 'PRODUCT' && !r.restock) throw new AppError(400, 'VALIDATION_ERROR', `Say whether ${line.name} can be sold again or is damaged`);
    return { lineId: line._id, kind: line.kind, name: line.name, qty: r.qty, restock: line.kind === 'PRODUCT' ? r.restock : null, ...creditForLine(line, r.qty) };
  });
  const creditTotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const { netValue, netPaid } = moneyState(invoice);
  // Money paid beyond what the bill is worth after the refund goes back; the rest of the credit lowers what is owed
  const cashRefund = Math.max(0, netPaid - (netValue - creditTotal));
  return { lines, creditTotal, cashRefund, dueReduced: creditTotal - cashRefund };
}

async function loadRefund(ctx, id, session = null) {
  const refund = await Refund.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!refund || !ctx.allowedBranchIds.includes(String(refund.branchId))) throw new AppError(404, 'NOT_FOUND', 'Refund not found');
  return refund;
}

// Who gets the bell for a refund request: the branch's owners if they may approve refunds, otherwise the business owner(s)
async function approverIds(ctx, branchId, settings) {
  const branchOwnersMay = settings.branchOwners?.approveRefunds !== false;
  const who = branchOwnersMay ? { $or: [{ allBranches: true }, { branchIds: branchId }] } : { allBranches: true };
  return User.find(scoped(ctx, { role: 'OWNER', status: 'active', ...who })).distinct('_id');
}

// Preview for the refund screen (nothing saved)
export async function quoteRefund(ctx, { invoiceId, lines }) {
  const invoice = await loadInvoice(ctx, invoiceId);
  if (invoice.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can be refunded');
  return planRefund(invoice, lines);
}

// The front desk asks; an owner who may approve refunds does it at once.
// input: { invoiceId, lines: [{ lineId, qty, restock }], reason, method, reference }
export async function createRefund(ctx, { invoiceId, lines, reason, method = 'CASH', reference }, key) {
  const first = await loadInvoice(ctx, invoiceId);
  if (first.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can be refunded');
  if (!reason?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Say why it is being refunded');
  const settings = await getBillingSettings(ctx);
  const mayApprove = billingPermissions(ctx, settings).approveRefunds;

  const result = await runOnce(ctx, { key, operation: 'billing.refund.create' }, async (session) => {
    const invoice = await loadInvoice(ctx, invoiceId, session);
    if (await Refund.exists({ invoiceId: invoice._id, status: 'REQUESTED' }).session(session)) {
      throw new AppError(409, 'REFUND_PENDING', 'A refund on this bill is already waiting for an owner. Approve or turn it down first.');
    }
    const plan = planRefund(invoice, lines);
    const [refund] = await Refund.create(
      [
        {
          orgId: ctx.orgId,
          branchId: invoice.branchId,
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          customerId: invoice.customerId,
          customerName: invoice.customerSnapshot?.name,
          lines: plan.lines,
          reason: reason.trim(),
          method,
          reference,
          creditTotal: plan.creditTotal,
          cashRefund: plan.cashRefund,
          dueReduced: plan.dueReduced,
          requestedBy: ctx.userId,
          requestedByName: ctx.userName,
          requestedAt: new Date(),
        },
      ],
      { session }
    );

    if (mayApprove) {
      await carryOut(ctx, refund.toObject(), { session, settings });
    } else {
      const summary = `Asked to refund ${plan.lines.map((l) => `${l.qty} × ${l.name}`).join(', ')} on bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name} (${formatMoney(plan.creditTotal)}): ${reason.trim()}`;
      await logActivity(ctx, { action: 'billing.refund_requested', branchId: invoice.branchId, invoiceId: invoice._id, summary, after: { refundId: refund._id, creditTotal: plan.creditTotal } }, session);
      await notify(ctx, await approverIds(ctx, invoice.branchId, settings), { message: `${ctx.userName}: ${summary}`, link: LINK(invoice._id) }, session);
    }
    const saved = await Refund.findById(refund._id).session(session).lean();
    return { refund: saved, invoice: await present(ctx, await Invoice.findById(invoice._id).session(session).lean(), { session, settings }) };
  });
  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}

// An owner approves a waiting request. method/reference: how the money goes back (they may change it).
export async function approveRefund(ctx, id, { method, reference }, key) {
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).approveRefunds) throw new AppError(403, 'FORBIDDEN', 'You can’t approve refunds');
  const first = await loadRefund(ctx, id);
  const result = await runOnce(ctx, { key, operation: 'billing.refund.approve' }, async (session) => {
    const refund = await loadRefund(ctx, id, session);
    if (refund.status !== 'REQUESTED') throw new AppError(409, 'NOT_PENDING', 'This refund is not waiting for approval');
    const done = await carryOut(ctx, { ...refund, method: method ?? refund.method, reference: reference ?? refund.reference }, { session, settings });
    await notify(ctx, [refund.requestedBy], { message: `${ctx.userName} approved the refund on bill ${refund.invoiceNumber}: ${MONEY(done)}`, link: LINK(refund.invoiceId) }, session);
    return { refund: done, invoice: await present(ctx, await Invoice.findById(refund.invoiceId).session(session).lean(), { session, settings }) };
  });
  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}

export async function rejectRefund(ctx, id, { note }, key) {
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).approveRefunds) throw new AppError(403, 'FORBIDDEN', 'You can’t decide on refunds');
  if (!note?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Say why the refund is turned down');
  await loadRefund(ctx, id);
  return runOnce(ctx, { key, operation: 'billing.refund.reject' }, async (session) => {
    const refund = await loadRefund(ctx, id, session);
    if (refund.status !== 'REQUESTED') throw new AppError(409, 'NOT_PENDING', 'This refund is not waiting for approval');
    const saved = await Refund.findOneAndUpdate(
      { _id: refund._id, status: 'REQUESTED' },
      { $set: { status: 'REJECTED', decidedBy: ctx.userId, decidedByName: ctx.userName, decidedAt: new Date(), decisionNote: note.trim() } },
      { returnDocument: 'after', session }
    ).lean();
    const summary = `Turned down the refund on bill ${refund.invoiceNumber} for ${refund.customerName}: ${note.trim()}`;
    await logActivity(ctx, { action: 'billing.refund_rejected', branchId: refund.branchId, invoiceId: refund.invoiceId, summary }, session);
    await notify(ctx, [refund.requestedBy], { message: `${ctx.userName}: ${summary}`, link: LINK(refund.invoiceId) }, session);
    return { refund: saved, invoice: await present(ctx, await Invoice.findById(refund.invoiceId).session(session).lean(), { session, settings }) };
  });
}

// One refund with its credit note, for the printable credit note
export async function getRefund(ctx, id) {
  const refund = await loadRefund(ctx, id);
  const creditNote = refund.creditNoteId ? await CreditNote.findById(refund.creditNoteId).lean() : null;
  const branch = await Branch.findById(refund.branchId).select('name timezone').lean();
  return { refund, creditNote, branch };
}

// ---------------------------------------------------------------------------
// Doing the refund, inside the caller's transaction. Amounts are worked out again from the bill as it is now.
// ---------------------------------------------------------------------------
async function carryOut(ctx, refund, { session, settings }) {
  const invoice = await Invoice.findById(refund.invoiceId).session(session).lean();
  if (invoice.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can be refunded');
  const plan = planRefund(invoice, refund.lines);
  const branch = await Branch.findById(invoice.branchId).select('timezone').session(session).lean();
  const now = new Date();

  // 1. The bill: refunded units and amounts per line, its new value, what was handed back, what is still owed
  const lines = invoice.lines.map((line) => {
    const part = plan.lines.find((p) => String(p.lineId) === String(line._id));
    if (!part) return line;
    return {
      ...line,
      refundedQty: (line.refundedQty ?? 0) + part.qty,
      creditedTaxable: (line.creditedTaxable ?? 0) + part.taxableAmount,
      creditedCgst: (line.creditedCgst ?? 0) + part.cgst,
      creditedSgst: (line.creditedSgst ?? 0) + part.sgst,
      creditedAmount: (line.creditedAmount ?? 0) + part.amount,
    };
  });
  const after = { ...invoice, lines, creditedTotal: (invoice.creditedTotal ?? 0) + plan.creditTotal, refundedTotal: (invoice.refundedTotal ?? 0) + plan.cashRefund };
  const updated = await Invoice.findOneAndUpdate(
    { _id: invoice._id, status: 'ISSUED', version: invoice.version },
    {
      $set: {
        lines,
        creditedTotal: after.creditedTotal,
        refundedTotal: after.refundedTotal,
        balanceDue: moneyState(after).balanceDue,
        refundStatus: lines.every((l) => (l.refundedQty ?? 0) >= l.qty) ? 'FULL' : 'PARTIAL',
      },
      $inc: { version: 1 },
    },
    { returnDocument: 'after', session }
  ).lean();
  if (!updated) throw new AppError(409, 'STALE_VERSION', 'This bill was just changed by someone else. Please try again.');
  await settle(updated, { session, timezone: branch.timezone });

  // 2. Money back
  let refundPaymentId = null;
  if (plan.cashRefund > 0) {
    const [payment] = await Payment.create(
      [{ orgId: invoice.orgId, branchId: invoice.branchId, customerId: invoice.customerId, kind: 'REFUND', method: refund.method, amount: plan.cashRefund, reference: refund.reference, recordedBy: ctx.userId, source: 'REFUND', refundId: refund._id }],
      { session }
    );
    refundPaymentId = payment._id;
  }

  // 3. GST bills: a credit note with its own number
  let creditNote = null;
  if (invoice.gstRegistered) {
    const fy = financialYear(now, branch.timezone);
    const billing = await branchBilling(ctx, invoice.branchId, settings, session);
    const counter = await Counter.findOneAndUpdate({ _id: `creditnote:${invoice.branchId}:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
    const sum = (field) => plan.lines.reduce((total, l) => total + l[field], 0);
    [creditNote] = await CreditNote.create(
      [
        {
          orgId: invoice.orgId,
          branchId: invoice.branchId,
          invoiceId: invoice._id,
          invoiceNumber: invoice.invoiceNumber,
          invoiceDate: invoice.issuedAt,
          refundId: refund._id,
          number: formatCreditNoteNumber(billing.invoicePrefix, fy, counter.seq),
          financialYear: fy,
          issuedAt: now,
          reason: refund.reason,
          lines: plan.lines.map((l) => {
            const line = invoice.lines.find((x) => String(x._id) === String(l.lineId));
            return { name: l.name, code: line.sacCode ?? line.hsnCode, qty: l.qty, taxableAmount: l.taxableAmount, taxRateBps: l.taxRateBps, cgst: l.cgst, sgst: l.sgst, amount: l.amount };
          }),
          taxableTotal: sum('taxableAmount'),
          cgstTotal: sum('cgst'),
          sgstTotal: sum('sgst'),
          total: plan.creditTotal,
          seller: invoice.seller,
          customerSnapshot: invoice.customerSnapshot,
          createdBy: ctx.userId,
        },
      ],
      { session }
    );
  }

  // 4. Stock: sellable products back into the main store; damaged ones come back and are written off
  const productLines = plan.lines.filter((l) => l.kind === 'PRODUCT');
  if (productLines.length > 0) {
    const store = await InventoryLocation.findOne(scoped(ctx, { branchId: invoice.branchId, isMain: true })).session(session).lean();
    for (const part of productLines) {
      const skuId = invoice.lines.find((x) => String(x._id) === String(part.lineId)).skuId;
      const base = { branchId: invoice.branchId, reference: { kind: 'invoice', id: invoice._id } };
      await postMovement(ctx, { ...base, type: 'SALE_RETURN', note: `Returned on bill ${invoice.invoiceNumber}`, requestKey: `return:${refund._id}:${part.lineId}`, lines: [{ skuId, locationId: store._id, qty: part.qty, bucket: 'SOLD' }] }, session);
      if (part.restock === 'DAMAGED') {
        await postMovement(
          ctx,
          { ...base, type: 'WRITE_OFF', reason: 'DAMAGE', note: `Returned damaged on bill ${invoice.invoiceNumber}`, requestKey: `return-damaged:${refund._id}:${part.lineId}`, lines: [{ skuId, locationId: store._id, qty: -part.qty, bucket: 'WASTED' }] },
          session
        );
      }
    }
  }

  // 5. Commission on refunded services is taken back (a service is always refunded whole)
  const serviceItemIds = plan.lines.filter((l) => l.kind === 'SERVICE').map((l) => invoice.lines.find((x) => String(x._id) === String(l.lineId)).itemId).filter(Boolean);
  if (serviceItemIds.length > 0) await reverseCommissions({ invoice, itemIds: serviceItemIds, eventKey: `refund:${refund._id}`, day: todayInZone(branch.timezone) }, session);

  const done = await Refund.findOneAndUpdate(
    { _id: refund._id, status: 'REQUESTED' },
    {
      $set: {
        status: 'DONE',
        lines: plan.lines,
        method: refund.method,
        reference: refund.reference,
        creditTotal: plan.creditTotal,
        cashRefund: plan.cashRefund,
        dueReduced: plan.dueReduced,
        creditNoteId: creditNote?._id ?? null,
        creditNoteNumber: creditNote?.number,
        refundPaymentId,
        decidedBy: ctx.userId,
        decidedByName: ctx.userName,
        decidedAt: now,
      },
    },
    { returnDocument: 'after', session }
  ).lean();
  if (!done) throw new AppError(409, 'NOT_PENDING', 'This refund was just decided by someone else');

  const what = plan.lines.map((l) => `${l.qty} × ${l.name}${l.restock === 'DAMAGED' ? ' (damaged)' : ''}`).join(', ');
  const owed = plan.dueReduced > 0 ? `, ${formatMoney(plan.dueReduced)} off what was owed` : '';
  await logActivity(
    ctx,
    { action: 'billing.refund_done', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Refunded ${what} on bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name}: ${formatMoney(plan.creditTotal)} (${MONEY(done)}${owed})${creditNote ? `, credit note ${creditNote.number}` : ''}. Reason: ${refund.reason}`, after: { refundId: refund._id, creditTotal: plan.creditTotal, cashRefund: plan.cashRefund } },
    session
  );
  return done;
}
