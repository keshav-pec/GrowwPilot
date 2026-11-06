import { Branch, Counter, CustomerAdvance, Customer, Invoice, Organization, Payment, PaymentAllocation } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { markPayrollStale } from '../payroll/payrollStale.js';
import { reverseCommissions } from '../payroll/commission.service.js';
import { moneyState } from '../billing/tax.rules.js';
import { billingPermissions, branchBilling, getBillingSettings } from '../billing/settings.service.js';
import { financialYear, formatVoucherNumber } from '../../config/billing.js';
import { advanceBuyer, advanceTaxFor, advanceTaxPart, takeAdvanceTax } from '../gst/gst.advances.js';
import { gstSetupActive } from '../gst/gst.billing.js';
import { postAdvanceReceived, postAdvanceRefunded, postAdvanceReversed } from '../gst/gst.ledger.js';
import { present } from '../invoices/invoices.service.js';
import { advancesOf, applyPayments, settle } from './allocations.js';

const METHOD_WORDS = { CASH: 'cash', UPI: 'UPI', CARD: 'card', OTHER: 'other' };
const describe = (payments) => payments.map((p) => `${formatMoney(p.amount)} ${METHOD_WORDS[p.method]}`).join(' + ');

// "Record payment" on an issued bill that still has something due, e.g. the ₹680 left after a part payment.
// input: { invoiceId, payments: [{ method, amount, reference }], useAdvance (paise), keepExtraAsAdvance }
export async function recordPayments(ctx, { invoiceId, payments, useAdvance = 0, sources = [], keepExtraAsAdvance = false }, key) {
  if (payments.length === 0 && !useAdvance && sources.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Add at least one payment');
  const first = await Invoice.findOne(scoped(ctx, { _id: invoiceId })).select('branchId status').lean();
  if (!first || !ctx.allowedBranchIds.includes(String(first.branchId))) throw new AppError(404, 'NOT_FOUND', 'Bill not found');
  if (first.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can take payments');

  const result = await runOnce(ctx, { key, operation: 'billing.payment.record' }, async (session) => {
    const invoice = await Invoice.findOne(scoped(ctx, { _id: invoiceId })).session(session).lean();
    const branch = await Branch.findById(invoice.branchId).select('timezone').session(session).lean();
    const { invoice: updated, advanceKept } = await applyPayments(ctx, invoice, payments, { session, source: 'LATER', timezone: branch.timezone, advance: useAdvance, sources, keepExtraAsAdvance });

    const parts = [payments.length && describe(payments), useAdvance && `${formatMoney(useAdvance)} from advance`].filter(Boolean).join(' + ');
    const left = updated.balanceDue === 0 ? 'now fully paid' : `${formatMoney(updated.balanceDue)} still due`;
    const kept = advanceKept > 0 ? `; ${formatMoney(advanceKept)} kept as advance` : '';
    await logActivity(
      ctx,
      { action: 'billing.payment_recorded', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Recorded ${parts} on bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name}; ${left}${kept}`, after: { invoiceNumber: invoice.invoiceNumber, payments, useAdvance, advanceKept, balanceDue: updated.balanceDue } },
      session
    );
    return present(ctx, updated, { session });
  });

  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}

// ---------------------------------------------------------------------------
// Reverse a payment that was recorded by mistake (owners, with a reason). The payment stays in the records,
// marked reversed. On a bill, the amount becomes due again (and commission earned on it is taken back);
// an advance payment can only be reversed while none of it has been used.
// ---------------------------------------------------------------------------
export async function reversePayment(ctx, paymentId, { reason }, key) {
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).reversePayments) throw new AppError(403, 'FORBIDDEN', 'Only an owner can reverse a payment');
  if (!reason?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Say why the payment is reversed');
  const first = await Payment.findOne(scoped(ctx, { _id: paymentId, kind: 'RECEIPT' })).lean();
  if (!first || !ctx.allowedBranchIds.includes(String(first.branchId))) throw new AppError(404, 'NOT_FOUND', 'Payment not found');

  const result = await runOnce(ctx, { key, operation: 'billing.payment.reverse' }, async (session) => {
    const payment = await Payment.findOne({ _id: first._id }).session(session).lean();
    if (payment.status !== 'VALID') throw new AppError(409, 'ALREADY_REVERSED', 'This payment has already been reversed');
    const branch = await Branch.findById(payment.branchId).select('timezone').session(session).lean();

    // Money that was kept as an advance: only while it is still all there
    const advance = await CustomerAdvance.findOne({ orgId: payment.orgId, 'sources.paymentId': payment._id }).session(session).lean();
    if (advance) {
      const part = advance.sources.find((s) => String(s.paymentId) === String(payment._id)).amount;
      // A taxed advance: its tax goes too, as a new minus entry. The original entry stays.
      const untaxed = advance.taxed ? { 'gst.leftTaxable': 0, 'gst.leftCgst': 0, 'gst.leftSgst': 0, 'gst.leftIgst': 0, reversedAt: new Date() } : {};
      const taken = await CustomerAdvance.updateOne({ _id: advance._id, remaining: { $gte: part } }, { $inc: { remaining: -part }, ...(advance.taxed ? { $set: untaxed } : {}) }, { session });
      if (taken.modifiedCount !== 1) throw new AppError(409, 'ADVANCE_USED', 'This advance has already been used on a bill or given back, so the payment can’t be reversed');
      if (advance.taxed) await postAdvanceReversed(ctx, advance, { taxDate: todayInZone(branch.timezone) }, session);
    }

    let invoice = null;
    const allocations = await PaymentAllocation.find({ paymentId: payment._id, status: 'VALID' }).session(session).lean();
    for (const allocation of allocations) {
      const bill = await Invoice.findOne({ _id: allocation.invoiceId }).session(session).lean();
      const after = { ...bill, amountPaid: bill.amountPaid - allocation.amount };
      if (moneyState(after).netPaid < 0) throw new AppError(409, 'ALREADY_REFUNDED', 'Money from this payment has already been refunded, so it can’t be reversed');
      const updated = await Invoice.findOneAndUpdate(
        { _id: bill._id, version: bill.version },
        { $inc: { amountPaid: -allocation.amount, version: 1 }, $set: { balanceDue: moneyState(after).balanceDue } },
        { returnDocument: 'after', session }
      ).lean();
      if (!updated) throw new AppError(409, 'STALE_VERSION', 'This bill was just changed by someone else. Please try again.');
      await PaymentAllocation.updateOne({ _id: allocation._id }, { $set: { status: 'REVERSED' } }, { session });
      invoice = await settle(updated, { session, timezone: branch.timezone });
      // It was fully paid and isn't any more: the stylists' commission on it is taken back (it comes back when paid again)
      if (bill.settlementStatus === 'PAID' && invoice.settlementStatus !== 'PAID') {
        await reverseCommissions({ invoice, eventKey: `payment_reversed:${payment._id}`, day: todayInZone(branch.timezone) }, session);
      }
    }

    await Payment.updateOne({ _id: payment._id }, { $set: { status: 'REVERSED', reversal: { at: new Date(), by: ctx.userId, byName: ctx.userName, reason: reason.trim() } } }, { session });
    const where = invoice ? `bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name}` : 'an advance';
    await logActivity(
      ctx,
      { action: 'billing.payment_reversed', branchId: payment.branchId, invoiceId: invoice?._id, summary: `Reversed ${formatMoney(payment.amount)} (${METHOD_WORDS[payment.method]}) on ${where}: ${reason.trim()}`, before: { status: 'VALID' }, after: { status: 'REVERSED', reason: reason.trim(), balanceDue: invoice?.balanceDue } },
      session
    );
    return invoice ? { invoice: await present(ctx, invoice, { session, settings }) } : { invoice: null };
  });
  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}

// ---------------------------------------------------------------------------
// Customer advances: money paid ahead, used on later bills at any branch.
// ---------------------------------------------------------------------------
// forServiceIds: the advance is for these services. It is taxed now, with a receipt voucher, and the tax is used up on later bills.
// Otherwise it is a plain advance, not taxed when received.
// billId: this money is for a bill already issued, which is refused for a taxed advance: that bill already has the tax.
export async function takeAdvance(ctx, { customerId, method, amount, reference, note, forServiceIds = [], billId = null }, key) {
  const customer = await Customer.findOne(scoped(ctx, { _id: customerId })).select('name').lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const branchId = ctx.activeBranchId;

  return runOnce(ctx, { key, operation: 'billing.advance.take' }, async (session) => {
    const settings = await getBillingSettings(ctx, session);
    const taxed = forServiceIds.length > 0 ? await advanceTaxFor(ctx, { branchId, amount, forServiceIds, billId, settings }, session) : null;
    const [payment] = await Payment.create([{ orgId: ctx.orgId, branchId, customerId, method, amount, reference, recordedBy: ctx.userId, source: 'ADVANCE' }], { session });

    const doc = { orgId: ctx.orgId, branchId, customerId, amount, remaining: amount, sources: [{ paymentId: payment._id, amount }], note: note?.trim() || undefined, createdBy: ctx.userId };
    if (taxed) {
      const branch = await Branch.findById(branchId).select('name address city timezone').session(session).lean();
      const billing = await branchBilling(ctx, branchId, settings, session);
      const org = await Organization.findById(ctx.orgId).select('name').session(session).lean();
      const fy = financialYear(new Date(), branch.timezone);
      const counter = await Counter.findOneAndUpdate({ _id: `advancereceipt:${branchId}:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
      Object.assign(doc, {
        taxed: true,
        receiptNumber: formatVoucherNumber('RV', billing.invoicePrefix, fy, counter.seq),
        financialYear: fy,
        forServices: taxed.forServices,
        gst: { ...taxed.gst, ...(await advanceBuyer(ctx, customerId, session)), tradeName: org.name, branchName: branch.name, address: [branch.address, branch.city].filter(Boolean).join(', ') },
      });
    }
    const [advance] = await CustomerAdvance.create([doc], { session });
    if (taxed) await postAdvanceReceived(ctx, advance.toObject(), settings, session);

    const what = taxed ? `, with receipt voucher ${doc.receiptNumber} and ${formatMoney(doc.gst.cgst + doc.gst.sgst + doc.gst.igst)} GST` : '';
    await logActivity(ctx, { action: 'billing.advance_taken', branchId, summary: `Took an advance of ${formatMoney(amount)} (${METHOD_WORDS[method]}) from ${customer.name}${what}${note?.trim() ? `: ${note.trim()}` : ''}` }, session);
    return customerAdvances(ctx, customerId, session);
  });
}

// What an advance for these services would carry in tax. Nothing is saved.
export async function quoteAdvance(ctx, { amount, forServiceIds }) {
  const settings = await getBillingSettings(ctx);
  const { gst, forServices } = await advanceTaxFor(ctx, { branchId: ctx.activeBranchId, amount, forServiceIds, settings });
  return { amount, forServices, taxRuleName: gst.taxRuleName, code: gst.code, rateBps: gst.rateBps, gstin: gst.gstin, placeOfSupply: gst.placeOfSupply, taxable: gst.taxable, cgst: gst.cgst, sgst: gst.sgst, igst: gst.igst };
}

async function loadAdvance(ctx, id, session = null) {
  const advance = await CustomerAdvance.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!advance) throw new AppError(404, 'NOT_FOUND', 'Advance not found');
  return advance;
}

// Giving back unused money (those who may approve refunds, at the branch it was taken). A taxed advance gets a numbered
// refund voucher, and a minus entry for the tax on that money. The original entry stays as it is.
export async function giveBackAdvance(ctx, id, { amount, method, reference, reason }, key) {
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).approveRefunds) throw new AppError(403, 'FORBIDDEN', 'You can’t give back advances');
  const first = await loadAdvance(ctx, id);
  if (!ctx.allowedBranchIds.includes(String(first.branchId))) throw new AppError(404, 'NOT_FOUND', 'Advance not found');

  return runOnce(ctx, { key, operation: 'billing.advance.give_back' }, async (session) => {
    const advance = await loadAdvance(ctx, id, session);
    if (amount > advance.remaining) throw new AppError(400, 'ADVANCE_TOO_LOW', `Only ${formatMoney(advance.remaining)} of this advance is left`);
    const branch = await Branch.findById(advance.branchId).select('timezone').session(session).lean();
    const customer = await Customer.findOne(scoped(ctx, { _id: advance.customerId })).select('name').session(session).lean();
    const [payment] = await Payment.create(
      [{ orgId: advance.orgId, branchId: advance.branchId, customerId: advance.customerId, kind: 'REFUND', method, amount, reference, recordedBy: ctx.userId, source: 'REFUND', advanceId: advance._id }],
      { session }
    );

    const tax = advance.taxed ? advanceTaxPart(advance, amount) : null;
    const part = tax ? { taxable: tax.taxableAmount, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst } : {};
    let number;
    if (tax) {
      const billing = await branchBilling(ctx, advance.branchId, settings, session);
      const fy = financialYear(new Date(), branch.timezone);
      const counter = await Counter.findOneAndUpdate({ _id: `advancerefund:${advance.branchId}:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
      number = formatVoucherNumber('RF', billing.invoicePrefix, fy, counter.seq);
    }
    const refund = { number, amount, paymentId: payment._id, method, reference, reason: reason.trim(), at: new Date(), byName: ctx.userName, ...part };
    const saved = await CustomerAdvance.updateOne(
      { _id: advance._id, remaining: { $gte: amount } },
      { $inc: { remaining: -amount, givenBack: amount, ...(tax ? takeAdvanceTax(tax) : {}) }, $push: { refunds: refund } },
      { session }
    );
    if (saved.modifiedCount !== 1) throw new AppError(409, 'ADVANCE_CHANGED', 'That advance was just used. Please try again.');
    if (tax) await postAdvanceRefunded(ctx, advance, { paymentId: payment._id, number, part, taxDate: todayInZone(branch.timezone) }, session);

    await logActivity(ctx, { action: 'billing.advance_given_back', branchId: advance.branchId, summary: `Gave back ${formatMoney(amount)} (${METHOD_WORDS[method]}) of ${customer?.name}’s advance${number ? `, refund voucher ${number}` : ''}: ${reason.trim()}`, after: { advanceId: advance._id, amount, number } }, session);
    return customerAdvances(ctx, advance.customerId, session);
  });
}

// One advance, for its receipt voucher: the money, the tax, and where it went
export async function getAdvance(ctx, id) {
  const advance = await loadAdvance(ctx, id);
  const uses = await PaymentAllocation.find({ advanceId: advance._id, status: 'VALID' }).populate('invoiceId', 'invoiceNumber').lean();
  const branch = await Branch.findById(advance.branchId).select('name timezone').lean();
  const customer = await Customer.findOne(scoped(ctx, { _id: advance.customerId })).select('name phone').lean();
  return { advance, branch, customer, uses: uses.map((u) => ({ invoiceId: u.invoiceId?._id, invoiceNumber: u.invoiceId?.invoiceNumber, amount: u.amount, advanceTax: u.advanceTax, at: u.createdAt })) };
}

// A customer's advances: what's left, and each advance with the bills it paid
export async function customerAdvances(ctx, customerId, session = null) {
  const customer = await Customer.findOne(scoped(ctx, { _id: customerId })).select('_id').session(session).lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  const advances = await CustomerAdvance.find(scoped(ctx, { customerId })).sort({ createdAt: -1 }).populate('branchId', 'name').populate('createdBy', 'name').session(session).lean();
  const uses = await PaymentAllocation.find({ advanceId: { $in: advances.map((a) => a._id) }, status: 'VALID' }).populate('invoiceId', 'invoiceNumber').session(session).lean();
  const reversed = await Payment.find({ _id: { $in: advances.flatMap((a) => a.sources.map((s) => s.paymentId)) }, status: 'REVERSED' }).select('_id').session(session).lean();
  const isReversed = (a) => a.sources.length > 0 && a.sources.every((s) => reversed.some((p) => String(p._id) === String(s.paymentId)));
  const settings = await getBillingSettings(ctx, session);
  return {
    balance: (await advancesOf(ctx, customerId, session)).balance,
    namedAllowed: gstSetupActive(settings), // advances for named services need GST setup
    canGiveBack: billingPermissions(ctx, settings).approveRefunds,
    advances: advances.map((a) => ({
      ...a,
      reversed: isReversed(a), // the payment it came from was reversed: nothing left to use
      uses: uses.filter((u) => String(u.advanceId) === String(a._id)).map((u) => ({ invoiceId: u.invoiceId?._id, invoiceNumber: u.invoiceId?.invoiceNumber, amount: u.amount, at: u.createdAt })),
    })),
  };
}
