import mongoose from 'mongoose';
import { Appointment, Branch, Counter, Customer, Invoice, Organization, Payment, PaymentAllocation, Service } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { escapeRegex } from '../../utils/regex.js';
import { dayRangeUTC } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { financialYear, formatInvoiceNumber } from '../../config/billing.js';
import { splitByPrice } from '../payroll/commission.rules.js';
import { markPayrollStale } from '../payroll/payrollStale.js';
import { logActivity } from '../activity/activity.service.js';
import { branchApproverIds, notify } from '../notifications/notifications.service.js';
import { computeBill, discountLimit } from '../billing/tax.rules.js';
import { branchBilling, getBillingSettings } from '../billing/settings.service.js';
import { applyPayments } from '../payments/allocations.js';

export { branchCode } from '../billing/settings.service.js';

// ---------------------------------------------------------------------------
// Bills (BILLING_PLAN.md, Phase 1). One checkout for everything:
//   1. Opening checkout for a finished appointment makes a DRAFT bill (no number yet, can be changed).
//   2. While it's a draft: discounts per line or on the whole bill, and owners may change a price (with a reason).
//      The server always works out prices and GST; the screen only shows what the server says.
//   3. "Issue & Pay" gives it its number and locks it, in one transaction with any payments taken.
//      Paying less than the total is fine: the rest stays due, and "Record payment" takes it later.
// A front desk discount above the salon's limit waits for an owner to approve it first.
// ---------------------------------------------------------------------------

const LINK = (invoice) => `/app/invoices/${invoice._id}`;
const isOwner = (ctx) => ctx.role === 'OWNER';

function stale() {
  return new AppError(409, 'STALE_VERSION', 'This bill was just changed by someone else. Please reload it.');
}

// A bill in this salon, at a branch this user may use
async function loadInvoice(ctx, id, session = null) {
  const invoice = await Invoice.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!invoice || !ctx.allowedBranchIds.includes(String(invoice.branchId))) throw new AppError(404, 'NOT_FOUND', 'Bill not found');
  return invoice;
}

function assertDraft(invoice) {
  if (invoice.status !== 'DRAFT') throw new AppError(409, 'ALREADY_ISSUED', `This bill has already been issued (${invoice.invoiceNumber})`);
}

// ---------------------------------------------------------------------------
// Working out a draft: applies the requested changes, looks up today's GST rates and runs the bill maths.
// Returns the fields to save, and where the bill stands with the front desk discount limit.
// edits: { billDiscount?: { type, value }, lines?: [{ lineId, discount?: { type, value } | null, unitPrice?, priceChangeReason? }] }
// ---------------------------------------------------------------------------
async function priceDraft(ctx, invoice, edits = {}, { session = null, settings } = {}) {
  settings ??= await getBillingSettings(ctx, session);
  const serviceIds = invoice.lines.map((l) => l.serviceId).filter(Boolean);
  const services = await Service.find(scoped(ctx, { _id: { $in: serviceIds } })).select('taxRateBps sacCode').session(session).lean();
  const serviceOf = (id) => services.find((s) => String(s._id) === String(id));

  const priceChanges = [];
  for (const change of edits.lines ?? []) {
    if (!invoice.lines.some((l) => String(l._id) === change.lineId)) throw new AppError(400, 'VALIDATION_ERROR', 'That line is not on this bill');
  }
  const lines = invoice.lines.map((line) => {
    const next = { ...line };
    const change = edits.lines?.find((c) => c.lineId === String(line._id));
    if (change?.discount !== undefined) {
      next.discountType = change.discount?.type ?? 'flat';
      next.discountValue = change.discount?.value ?? 0;
    }
    if (change?.unitPrice !== undefined && change.unitPrice !== line.unitPrice) {
      if (!isOwner(ctx)) throw new AppError(403, 'FORBIDDEN', 'Only an owner can change a price');
      const backToList = change.unitPrice === line.listUnitPrice;
      if (!backToList && !change.priceChangeReason?.trim()) throw new AppError(400, 'REASON_REQUIRED', `Give a reason for changing the price of ${line.name}`);
      next.unitPrice = change.unitPrice;
      next.priceChangeReason = backToList ? undefined : change.priceChangeReason.trim();
      priceChanges.push({ name: line.name, from: line.unitPrice, to: change.unitPrice, reason: next.priceChangeReason });
    }
    // A combo's lower price only applies at the list price; a price an owner set is the price
    next.comboDiscount = next.unitPrice === next.listUnitPrice ? (next.listComboDiscount ?? 0) : 0;
    if (next.kind === 'SERVICE') {
      const service = serviceOf(next.serviceId);
      next.taxRateBps = settings.gstRegistered ? (service?.taxRateBps ?? settings.defaultServiceTaxBps) : 0;
      next.sacCode = service?.sacCode || settings.defaultSacCode || undefined;
    }
    return next;
  });

  const billDiscountType = edits.billDiscount !== undefined ? (edits.billDiscount?.type ?? 'flat') : invoice.billDiscountType;
  const billDiscountValue = edits.billDiscount !== undefined ? (edits.billDiscount?.value ?? 0) : invoice.billDiscountValue;
  const mode = { gstRegistered: settings.gstRegistered, pricesIncludeTax: settings.pricesIncludeTax };
  const bill = computeBill(
    lines.map((l) => ({ name: l.name, unitPrice: l.unitPrice, qty: l.qty, comboDiscount: l.comboDiscount, discount: { type: l.discountType, value: l.discountValue }, taxRateBps: l.taxRateBps })),
    { type: billDiscountType, value: billDiscountValue },
    mode
  );

  const fields = {
    lines: lines.map((l, i) => {
      const { gross, ...amounts } = bill.lines[i];
      return { ...l, ...amounts };
    }),
    billDiscountType,
    billDiscountValue,
    ...mode,
    subtotal: bill.totals.subtotal,
    comboDiscountTotal: bill.totals.comboDiscountTotal,
    manualDiscount: bill.totals.manualDiscount,
    discountTotal: bill.totals.discountTotal,
    taxableTotal: bill.totals.taxableTotal,
    cgstTotal: bill.totals.cgstTotal,
    sgstTotal: bill.totals.sgstTotal,
    taxTotal: bill.totals.taxTotal,
    grandTotal: bill.totals.grandTotal,
    balanceDue: bill.totals.grandTotal,
    taxSummary: bill.taxSummary,
  };

  // An approval only counts for the discount it was given for
  const approval = { ...(invoice.approval ?? { status: 'NONE' }) };
  const manual = fields.manualDiscount;
  if ((approval.status === 'PENDING' || approval.status === 'REJECTED') && manual !== approval.requestedDiscount) approval.status = 'NONE';
  if (approval.status === 'APPROVED' && manual > approval.approvedDiscount) approval.status = 'NONE';
  fields.approval = approval;

  return { fields, priceChanges, settings, limits: limitInfo(ctx, { ...fields, approval }, settings) };
}

// Where a bill stands with the front desk discount limit
function limitInfo(ctx, invoice, settings) {
  const limitAmount = discountLimit(invoice, settings.frontDeskDiscountLimitBps);
  const overLimit = invoice.manualDiscount > limitAmount;
  const approved = invoice.approval?.status === 'APPROVED' && invoice.manualDiscount <= invoice.approval.approvedDiscount;
  return { limitBps: settings.frontDeskDiscountLimitBps, limitAmount, overLimit, needsApproval: overLimit && !isOwner(ctx) && !approved };
}

// Payments on a bill, newest last: [{ method, amount, reference, receivedAt, source, recordedByName }]
async function paymentsOf(invoiceId, session = null) {
  const allocations = await PaymentAllocation.find({ invoiceId, status: 'VALID' }).sort({ createdAt: 1 }).session(session).lean();
  if (allocations.length === 0) return [];
  const payments = await Payment.find({ _id: { $in: allocations.map((a) => a.paymentId) } })
    .populate('recordedBy', 'name')
    .session(session)
    .lean();
  return allocations.map((a) => {
    const p = payments.find((x) => String(x._id) === String(a.paymentId));
    return { _id: p._id, method: p.method, amount: a.amount, reference: p.reference, receivedAt: p.receivedAt, source: p.source, recordedByName: p.recordedBy?.name };
  });
}

// What the screens get: the bill, its payments, and (for drafts) the discount limit and what this user may do.
// preview: `invoice` holds worked-out numbers that are not saved (a quote), shown over the saved draft.
export async function present(ctx, invoice, { session = null, settings, limits, preview = false } = {}) {
  const full = await Invoice.findOne({ _id: invoice._id })
    .populate('branchId', 'name address city timezone')
    .populate('customerId', 'name phone')
    .populate('appointmentId', 'startAt comboId')
    .session(session)
    .lean();
  const shown = preview ? { ...full, ...pickComputed(invoice) } : full;
  const result = { ...shown, payments: await paymentsOf(invoice._id, session) };
  if (shown.status === 'DRAFT') {
    settings ??= await getBillingSettings(ctx, session);
    result.limits = limits ?? limitInfo(ctx, shown, settings);
    result.permissions = {
      changePrice: isOwner(ctx),
      approve: isOwner(ctx) && shown.approval?.status === 'PENDING',
    };
  }
  return result;
}

// The worked-out fields of an unsaved preview (quote), laid over the saved draft
function pickComputed(invoice) {
  const { _id, orgId, branchId, appointmentId, customerId, createdAt, updatedAt, createdBy, ...rest } = invoice;
  return rest;
}

// ---------------------------------------------------------------------------
// Open checkout for a finished appointment: its draft bill, made the first time.
// Safe to call twice (or from two desks at once): there is only ever one live bill per appointment.
// ---------------------------------------------------------------------------
export async function openDraft(ctx, { appointmentId }) {
  const appointment = await Appointment.findOne(scoped(ctx, { _id: appointmentId })).lean();
  if (!appointment || !ctx.allowedBranchIds.includes(String(appointment.branchId))) throw new AppError(404, 'NOT_FOUND', 'Appointment not found');

  const existing = await Invoice.findOne(scoped(ctx, { appointmentId: appointment._id })).lean();
  if (existing) return present(ctx, existing);
  if (appointment.status !== 'COMPLETED') throw new AppError(409, 'NOT_COMPLETED', 'Only completed appointments can be checked out');

  // A combo's lower price is shared over its services by their prices (to the paisa)
  const prices = appointment.items.map((i) => i.price);
  const itemsTotal = prices.reduce((a, b) => a + b, 0);
  const shares = appointment.totalPrice < itemsTotal ? splitByPrice(prices, appointment.totalPrice) : prices;
  const draft = {
    _id: new mongoose.Types.ObjectId(),
    orgId: ctx.orgId,
    branchId: appointment.branchId,
    appointmentId: appointment._id,
    customerId: appointment.customerId,
    customerSnapshot: { name: appointment.customerSnapshot.name, phone: appointment.customerSnapshot.phone },
    status: 'DRAFT',
    billDiscountType: 'flat',
    billDiscountValue: 0,
    approval: { status: 'NONE' },
    createdBy: ctx.userId,
    lines: appointment.items.map((item, i) => ({
      _id: new mongoose.Types.ObjectId(),
      kind: 'SERVICE',
      itemId: item._id,
      serviceId: item.serviceId,
      staffId: item.staffId,
      staffName: item.staffName,
      name: item.serviceName,
      qty: 1,
      listUnitPrice: item.price,
      unitPrice: item.price,
      listComboDiscount: item.price - shares[i],
      discountType: 'flat',
      discountValue: 0,
    })),
  };
  const { fields } = await priceDraft(ctx, draft);

  try {
    const [created] = await Invoice.create([{ ...draft, ...fields }]);
    return present(ctx, created.toObject());
  } catch (err) {
    // Someone opened it at the same moment: use theirs
    if (err.code === 11000) return present(ctx, await Invoice.findOne(scoped(ctx, { appointmentId: appointment._id })).lean());
    throw err;
  }
}

// One bill (draft or issued) with its payments
export async function getInvoice(ctx, id) {
  return present(ctx, await loadInvoice(ctx, id));
}

// Live preview while the desk changes discounts: worked out by the server, nothing saved
export async function quoteDraft(ctx, id, edits) {
  const invoice = await loadInvoice(ctx, id);
  assertDraft(invoice);
  const { fields, settings, limits } = await priceDraft(ctx, invoice, edits);
  return present(ctx, { ...invoice, ...fields }, { settings, limits, preview: true });
}

// Saves the draft's changes. `version` must be the one the screen loaded, so two people never overwrite each other.
async function saveChanges(ctx, invoice, fields, priceChanges, session, extra = {}) {
  const updated = await Invoice.findOneAndUpdate(
    scoped(ctx, { _id: invoice._id, status: 'DRAFT', version: invoice.version }),
    { $set: { ...fields, ...extra }, $inc: { version: 1 } },
    { returnDocument: 'after', session, runValidators: true }
  ).lean();
  if (!updated) throw stale();
  for (const c of priceChanges) {
    await logActivity(
      ctx,
      { action: 'billing.price_changed', branchId: invoice.branchId, summary: `Changed the price of ${c.name} on ${invoice.customerSnapshot?.name}'s bill from ${formatMoney(c.from)} to ${formatMoney(c.to)}${c.reason ? ` (${c.reason})` : ''}`, before: { unitPrice: c.from }, after: { unitPrice: c.to, reason: c.reason } },
      session
    );
  }
  return updated;
}

export async function saveDraft(ctx, id, { version, ...edits }) {
  const invoice = await loadInvoice(ctx, id);
  assertDraft(invoice);
  if (invoice.version !== version) throw stale();
  const { fields, priceChanges, settings } = await priceDraft(ctx, invoice, edits);
  const updated = await mongoose.connection.transaction((session) => saveChanges(ctx, invoice, fields, priceChanges, session));
  return present(ctx, updated, { settings });
}

// ---------------------------------------------------------------------------
// Issue the bill: number, lock, and take any payments, all in one transaction.
// input: { version, payments: [{ method, amount, reference }], ...the same changes as saveDraft }
// ---------------------------------------------------------------------------
export async function issueInvoice(ctx, id, { version, payments = [], ...edits }, key) {
  const first = await loadInvoice(ctx, id); // 404 before anything else

  const result = await runOnce(ctx, { key, operation: 'billing.invoice.issue' }, async (session) => {
    const invoice = await loadInvoice(ctx, id, session);
    assertDraft(invoice);
    if (invoice.version !== version) throw stale();

    const { fields, priceChanges, settings, limits } = await priceDraft(ctx, invoice, edits, { session });
    if (limits.needsApproval) {
      if (fields.approval.status === 'PENDING') throw new AppError(409, 'APPROVAL_PENDING', 'This discount is waiting for an owner to approve it');
      throw new AppError(409, 'APPROVAL_NEEDED', `The discount is above the front desk limit of ${limits.limitBps / 100}% (${formatMoney(limits.limitAmount)} on this bill). Ask an owner to approve it first.`);
    }
    if (!invoice.customerId && fields.lines.some((l) => l.kind === 'SERVICE')) throw new AppError(400, 'CUSTOMER_REQUIRED', 'A bill with services needs a customer');

    const branch = await Branch.findById(invoice.branchId).select('name address city timezone').session(session).lean();
    const billing = await branchBilling(ctx, invoice.branchId, settings, session);
    if (settings.gstRegistered && !billing.gstin) {
      throw new AppError(409, 'GSTIN_MISSING', `${branch.name} has no GSTIN yet. An owner needs to add it in Billing settings before GST bills can be issued.`);
    }
    const paying = payments.reduce((sum, p) => sum + p.amount, 0);
    if (paying > fields.grandTotal) {
      throw new AppError(400, 'OVERPAID', `Payments are ${formatMoney(paying - fields.grandTotal)} more than the bill (${formatMoney(fields.grandTotal)})`);
    }

    // The appointment is billed now, only if nobody billed it in the meantime
    if (invoice.appointmentId) {
      const marked = await Appointment.updateOne(scoped(ctx, { _id: invoice.appointmentId, status: 'COMPLETED', invoiceId: null }), { $set: { invoiceId: invoice._id } }, { session });
      if (marked.modifiedCount !== 1) throw new AppError(409, 'ALREADY_PAID', 'This appointment has already been checked out');
    }

    // Next number for this branch and financial year (rolled back too if anything below fails)
    const now = new Date();
    const fy = financialYear(now, branch.timezone);
    const counter = await Counter.findOneAndUpdate({ _id: `invoice:${branch._id}:${fy}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
    const [customer, org] = await Promise.all([
      invoice.customerId ? Customer.findOne(scoped(ctx, { _id: invoice.customerId })).select('name phone').session(session).lean() : null,
      Organization.findById(ctx.orgId).select('name').session(session).lean(),
    ]);

    const issued = await saveChanges(ctx, invoice, fields, priceChanges, session, {
      status: 'ISSUED',
      invoiceNumber: formatInvoiceNumber(billing.invoicePrefix, fy, counter.seq),
      financialYear: fy,
      issuedAt: now,
      issuedBy: ctx.userId,
      seller: {
        legalName: settings.legalName || org.name,
        tradeName: org.name,
        branchName: branch.name,
        address: [branch.address, branch.city].filter(Boolean).join(', '),
        gstin: settings.gstRegistered ? billing.gstin : undefined,
        stateCode: billing.stateCode ?? undefined,
        stateName: billing.stateName ?? undefined,
      },
      customerSnapshot: customer ? { name: customer.name, phone: customer.phone } : invoice.customerSnapshot,
      amountPaid: 0,
      balanceDue: fields.grandTotal,
      settlementStatus: 'UNPAID',
    });

    // Takes the payments; a bill that ends up fully paid (or costs nothing) earns the stylists' commission
    const final = await applyPayments(ctx, issued, payments, { session, source: 'CHECKOUT', timezone: branch.timezone });

    const paid = final.amountPaid;
    const money = paid >= final.grandTotal ? 'paid in full' : paid > 0 ? `paid ${formatMoney(paid)}, ${formatMoney(final.balanceDue)} due` : 'nothing paid yet';
    await logActivity(
      ctx,
      { action: 'billing.bill_issued', branchId: invoice.branchId, summary: `Issued bill ${final.invoiceNumber} for ${final.customerSnapshot?.name}: ${formatMoney(final.grandTotal)} (${money})`, after: { invoiceNumber: final.invoiceNumber, grandTotal: final.grandTotal, amountPaid: paid, manualDiscount: final.manualDiscount } },
      session
    );
    return present(ctx, final, { session, settings });
  });

  await markPayrollStale(ctx.orgId, first.branchId); // commission and per-service pay may have changed
  return result;
}

// ---------------------------------------------------------------------------
// Discount approval: the front desk asks, an owner of the branch approves or says no.
// ---------------------------------------------------------------------------
export async function requestApproval(ctx, id, { version, note, ...edits }, key) {
  await loadInvoice(ctx, id);
  return runOnce(ctx, { key, operation: 'billing.discount.request' }, async (session) => {
    const invoice = await loadInvoice(ctx, id, session);
    assertDraft(invoice);
    if (invoice.version !== version) throw stale();
    const { fields, priceChanges, settings, limits } = await priceDraft(ctx, invoice, edits, { session });
    if (!limits.needsApproval) throw new AppError(400, 'NO_APPROVAL_NEEDED', 'This discount doesn’t need an owner’s approval. You can issue the bill.');
    if (fields.approval.status === 'PENDING') throw new AppError(409, 'APPROVAL_PENDING', 'This discount is already waiting for an owner to approve it');

    const approval = { status: 'PENDING', requestedBy: ctx.userId, requestedByName: ctx.userName, requestedAt: new Date(), requestedDiscount: fields.manualDiscount, note: note?.trim() || undefined };
    const updated = await saveChanges(ctx, invoice, { ...fields, approval }, priceChanges, session);
    const summary = `Asked to approve a ${formatMoney(fields.manualDiscount)} discount on ${invoice.customerSnapshot?.name}'s bill (limit ${formatMoney(limits.limitAmount)})`;
    await logActivity(ctx, { action: 'billing.discount_requested', branchId: invoice.branchId, summary, after: approval }, session);
    await notify(ctx, await branchApproverIds(ctx, invoice.branchId), { message: `${ctx.userName}: ${summary}${approval.note ? ` — “${approval.note}”` : ''}`, link: LINK(invoice) }, session);
    return present(ctx, updated, { session, settings });
  });
}

async function decide(ctx, id, { version, note }, key, approve) {
  if (!isOwner(ctx)) throw new AppError(403, 'FORBIDDEN', 'Only an owner can approve discounts');
  if (!approve && !note?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Say why the discount is turned down');
  await loadInvoice(ctx, id);
  return runOnce(ctx, { key, operation: approve ? 'billing.discount.approve' : 'billing.discount.reject' }, async (session) => {
    const invoice = await loadInvoice(ctx, id, session);
    assertDraft(invoice);
    if (invoice.version !== version) throw stale();
    if (invoice.approval?.status !== 'PENDING') throw new AppError(409, 'NOT_PENDING', 'There is no discount waiting for approval on this bill');

    const approval = {
      ...invoice.approval,
      status: approve ? 'APPROVED' : 'REJECTED',
      decidedBy: ctx.userId,
      decidedByName: ctx.userName,
      decidedAt: new Date(),
      decisionNote: note?.trim() || undefined,
      approvedDiscount: approve ? invoice.manualDiscount : undefined,
    };
    const updated = await saveChanges(ctx, invoice, { approval }, [], session);
    const summary = `${approve ? 'Approved' : 'Turned down'} the ${formatMoney(invoice.manualDiscount)} discount on ${invoice.customerSnapshot?.name}'s bill${approval.decisionNote ? ` (${approval.decisionNote})` : ''}`;
    await logActivity(ctx, { action: approve ? 'billing.discount_approved' : 'billing.discount_rejected', branchId: invoice.branchId, summary, after: approval }, session);
    await notify(ctx, [invoice.approval.requestedBy], { message: `${ctx.userName}: ${summary}`, link: LINK(invoice) }, session);
    return present(ctx, updated, { session });
  });
}

export const approveDiscount = (ctx, id, input, key) => decide(ctx, id, input, key, true);
export const rejectDiscount = (ctx, id, input, key) => decide(ctx, id, input, key, false);

// ---------------------------------------------------------------------------
// Bills list: search by number, customer name or phone; filter by dates, status and branch.
// status: DRAFT | UNPAID | PARTIALLY_PAID | PAID | DUE (anything still owed). Dates are in each branch's own time.
// ---------------------------------------------------------------------------
const PAGE_SIZE = 25;

export async function listInvoices(ctx, { search, status, branchId, from, to, page }) {
  const ids = branchId === 'all' ? ctx.allowedBranchIds : [branchId ?? ctx.activeBranchId];
  if (!ids.every((id) => ctx.allowedBranchIds.includes(id))) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  const branches = await Branch.find(scoped(ctx, { _id: { $in: ids } })).select('timezone').lean();

  // aggregate() doesn't turn text ids into ObjectIds like find() does, so the salon id is converted here
  const and = [{ orgId: new mongoose.Types.ObjectId(ctx.orgId), branchId: { $in: branches.map((b) => b._id) } }];
  if (status === 'DRAFT') and.push({ status: 'DRAFT' });
  else if (status === 'DUE') and.push({ status: 'ISSUED', balanceDue: { $gt: 0 } });
  else if (status) and.push({ status: 'ISSUED', settlementStatus: status });
  else and.push({ status: { $in: ['DRAFT', 'ISSUED'] } });

  if (from || to) {
    // An issued bill counts on the day it was issued; a draft on the day it was opened
    and.push({
      $or: branches.flatMap((b) => {
        const range = {};
        if (from) range.$gte = dayRangeUTC(from, b.timezone).start;
        if (to) range.$lt = dayRangeUTC(to, b.timezone).end;
        return [{ branchId: b._id, issuedAt: range }, { branchId: b._id, status: 'DRAFT', createdAt: range }];
      }),
    });
  }
  if (search) {
    const text = new RegExp(escapeRegex(search.trim()), 'i');
    const or = [{ invoiceNumber: text }, { 'customerSnapshot.name': text }];
    const digits = search.replace(/\D/g, '');
    if (digits.length >= 3) or.push({ 'customerSnapshot.phone': { $regex: digits } });
    and.push({ $or: or });
  }
  const filter = { $and: and };

  const [rows, total, sums] = await Promise.all([
    Invoice.find(filter)
      .select('invoiceNumber status settlementStatus customerSnapshot grandTotal amountPaid balanceDue issuedAt createdAt branchId appointmentId approval.status')
      .populate('branchId', 'name timezone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: { $and: [...and, { status: 'ISSUED' }] } },
      { $group: { _id: null, billed: { $sum: '$grandTotal' }, paid: { $sum: '$amountPaid' }, due: { $sum: '$balanceDue' }, count: { $sum: 1 } } },
    ]),
  ]);
  const totals = sums[0] ?? { billed: 0, paid: 0, due: 0, count: 0 };
  return { rows, page, pages: Math.max(Math.ceil(total / PAGE_SIZE), 1), total, totals: { billed: totals.billed, paid: totals.paid, due: totals.due, issued: totals.count } };
}
