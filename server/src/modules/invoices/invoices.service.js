import mongoose from 'mongoose';
import {
  ActivityLog, Appointment, Branch, Counter, Customer, InventorySku, InventorySkuBranch, Invoice, Organization, Payment, PaymentAllocation, Refund,
} from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { escapeRegex } from '../../utils/regex.js';
import { dayRangeUTC, todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { financialYear, formatInvoiceNumber } from '../../config/billing.js';
import { isMeasured } from '../../config/inventory.js';
import { splitByPrice } from '../payroll/commission.rules.js';
import { reverseCommissions } from '../payroll/commission.service.js';
import { markPayrollStale } from '../payroll/payrollStale.js';
import { logActivity } from '../activity/activity.service.js';
import { branchApproverIds, notify } from '../notifications/notifications.service.js';
import { computeBill, discountLimit } from '../billing/tax.rules.js';
import { billingPermissions, branchBilling, getBillingSettings } from '../billing/settings.service.js';
import { advancesOf, applyPayments } from '../payments/allocations.js';
import { PAYMENT_SOURCES, allocationSource } from '../payments/paymentSources.js';
import { byKind, kindOf, runHook } from '../billing/lineKinds.js';
import { branchStock } from '../inventory/stock/stock.queries.js';
import { makeShareToken, readShareToken, SHARE_DAYS } from './share.js';
import { redeemOffer, restoreOffer } from '../occasions/checkout/redeem.js';

export { branchCode } from '../billing/settings.service.js';

// ---------------------------------------------------------------------------
// Bills (BILLING_PLAN.md). One checkout for everything:
//   1. Opening checkout for a finished appointment makes a DRAFT bill (no number yet, can be changed).
//      "New sale" makes an empty draft for selling products only (to a customer, or a guest if allowed).
//   2. While it's a draft: products can be added (Inventory add-on), discounts given per line or on the whole bill,
//      and owners may change a price (with a reason). The server always works out prices and GST.
//   3. "Issue & Pay" gives it its number and locks it, in one transaction with the payments, any advance used
//      and the products leaving the stock. Paying less is fine: the rest stays due.
// A front desk discount above the salon's limit waits for an owner to approve it first.
// Refunds are in refunds/, later payments and reversals in payments/.
// ---------------------------------------------------------------------------

const LINK = (invoice) => `/app/invoices/${invoice._id}`;
const isOwner = (ctx) => ctx.role === 'OWNER';
const hasInventory = (ctx) => Boolean(ctx.addons?.includes('inventory'));
const MAX_QTY = 999;

function stale() {
  return new AppError(409, 'STALE_VERSION', 'This bill was just changed by someone else. Please reload it.');
}

// A bill in this salon, at a branch this user may use
export async function loadInvoice(ctx, id, session = null) {
  const invoice = await Invoice.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!invoice || !ctx.allowedBranchIds.includes(String(invoice.branchId))) throw new AppError(404, 'NOT_FOUND', 'Bill not found');
  return invoice;
}

function assertDraft(invoice) {
  if (invoice.status !== 'DRAFT') throw new AppError(409, 'ALREADY_ISSUED', `This bill has already been issued (${invoice.invoiceNumber})`);
}

function assertVersion(invoice, version) {
  if (invoice.version !== version) throw stale();
}

// ---------------------------------------------------------------------------
// Working out a draft: applies the requested changes, looks up today's GST rates and runs the bill maths.
// Returns the fields to save, and where the bill stands with the front desk discount limit.
// edits: { billDiscount?: { type, value }, lines?: [{ lineId, discount?: { type, value } | null, qty? (products), unitPrice?, priceChangeReason? }] }
// ---------------------------------------------------------------------------
// A service line counts for an occasion offer when its service is one the offer covers and it isn't part of a combo
export function occasionEligible(line, rules) {
  return Boolean(rules) && line.kind === 'SERVICE' && !line.listComboDiscount && (rules.serviceIds ?? []).map(String).includes(String(line.serviceId));
}

export async function priceDraft(ctx, invoice, edits = {}, { session = null, settings } = {}) {
  settings ??= await getBillingSettings(ctx, session);
  // What each kind of line needs to work out its GST (one after the other: reads in a transaction must not race)
  const lookups = {};
  for (const [name, kind, lines] of byKind(invoice.lines)) lookups[name] = await kind.lookup(ctx, lines, session);

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
    if (change?.qty !== undefined && change.qty !== line.qty) {
      if (!kindOf(line).hasQuantity) throw new AppError(400, 'VALIDATION_ERROR', `${line.name} has no quantity to change`);
      next.qty = change.qty;
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
    Object.assign(next, kindOf(next).tax(next, settings, lookups[next.kind]));
    return next;
  });

  const billDiscountType = edits.billDiscount !== undefined ? (edits.billDiscount?.type ?? 'flat') : invoice.billDiscountType;
  const billDiscountValue = edits.billDiscount !== undefined ? (edits.billDiscount?.value ?? 0) : invoice.billDiscountValue;
  const mode = { gstRegistered: settings.gstRegistered, pricesIncludeTax: settings.pricesIncludeTax };
  const offerRules = invoice.offer?.rules ?? null;
  const bill = computeBill(
    lines.map((l) => ({ name: l.name, unitPrice: l.unitPrice, qty: l.qty, comboDiscount: l.comboDiscount, discount: { type: l.discountType, value: l.discountValue }, taxRateBps: l.taxRateBps, discountable: kindOf(l).discountable, occasionEligible: occasionEligible(l, offerRules) })),
    { type: billDiscountType, value: billDiscountValue },
    mode,
    offerRules
  );
  // An occasion offer doesn't mix with other discounts
  if (invoice.offer && bill.totals.manualDiscount > 0) {
    throw new AppError(400, 'OFFER_NO_MIXING', 'An occasion offer can’t be combined with other discounts. Remove the offer to give a discount.');
  }

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
    occasionDiscountTotal: bill.totals.occasionDiscountTotal,
    // The offer re-worked for this bill (editing the bill changes it straight away)
    offer: invoice.offer ? { ...invoice.offer, eligibleSubtotal: bill.occasion.eligibleSubtotal, discount: bill.occasion.discount, eligible: bill.occasion.eligible, code: bill.occasion.code ?? null, shortBy: bill.occasion.shortBy ?? null } : null,
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

// Money put on a bill, oldest first: payments taken (also reversed ones, struck through on screen) and advances used
async function paymentsOf(invoiceId, session = null) {
  const allocations = await PaymentAllocation.find({ invoiceId }).sort({ createdAt: 1 }).session(session).lean();
  if (allocations.length === 0) return [];
  const payments = await Payment.find({ _id: { $in: allocations.map((a) => a.paymentId).filter(Boolean) } })
    .populate('recordedBy', 'name')
    .session(session)
    .lean();
  return allocations.map((a) => {
    const from = allocationSource(a); // money the customer already had (an advance...)
    if (from) return { _id: a._id, kind: from, method: from, label: PAYMENT_SOURCES[from].label, amount: a.amount, receivedAt: a.createdAt, source: from, status: a.status };
    const p = payments.find((x) => String(x._id) === String(a.paymentId));
    return {
      _id: p._id,
      kind: 'PAYMENT',
      method: p.method,
      amount: a.amount,
      reference: p.reference,
      receivedAt: p.receivedAt,
      source: p.source,
      recordedByName: p.recordedBy?.name,
      status: a.status,
      reversal: p.status === 'REVERSED' ? p.reversal : undefined,
    };
  });
}

// What the screens get: the bill, its payments, its refunds, the customer's advance, and what this user may do.
// Drafts also get the discount limit and the stock of each product.
// preview: `invoice` holds worked-out numbers that are not saved (a quote), shown over the saved draft.
export async function present(ctx, invoice, { session = null, settings, limits, preview = false } = {}) {
  const full = await Invoice.findOne({ _id: invoice._id })
    .populate('branchId', 'name address city timezone')
    .populate('customerId', 'name phone')
    .populate('appointmentId', 'startAt comboId')
    .session(session)
    .lean();
  const shown = preview ? { ...full, ...pickComputed(invoice) } : full;
  settings ??= await getBillingSettings(ctx, session);
  const can = billingPermissions(ctx, settings);
  const customerId = shown.customerId?._id ?? shown.customerId;
  const result = {
    ...shown,
    payments: await paymentsOf(invoice._id, session),
    advanceBalance: customerId ? (await advancesOf(ctx, customerId, session)).balance : 0,
  };

  if (shown.status === 'DRAFT') {
    result.limits = limits ?? limitInfo(ctx, shown, settings);
    result.permissions = { changePrice: can.changePrice, approve: can.approveDiscounts && shown.approval?.status === 'PENDING', addProducts: hasInventory(ctx) };
    // Products: how many are in the main store right now (issuing is refused if there aren't enough)
    const skuIds = shown.lines.filter((l) => l.kind === 'PRODUCT').map((l) => l.skuId);
    if (skuIds.length > 0) {
      const stock = await branchStock(ctx, shown.branchId._id, skuIds, session);
      result.stock = Object.fromEntries(Object.entries(stock).map(([skuId, s]) => [skuId, s.inStore]));
    }
  } else {
    result.refunds = await Refund.find({ invoiceId: invoice._id }).sort({ createdAt: 1 }).session(session).lean();
    result.permissions = {
      refund: shown.status === 'ISSUED' ? (can.approveRefunds ? 'approve' : 'request') : null,
      approveRefunds: can.approveRefunds,
      void: can.voidBills && shown.status === 'ISSUED' && shown.amountPaid === 0 && (shown.refundStatus ?? 'NONE') === 'NONE',
      reversePayments: can.reversePayments && shown.status === 'ISSUED',
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
  const draft = newDraft(ctx, {
    branchId: appointment.branchId,
    appointmentId: appointment._id,
    customerId: appointment.customerId,
    customerSnapshot: { name: appointment.customerSnapshot.name, phone: appointment.customerSnapshot.phone },
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
  });
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

function newDraft(ctx, fields) {
  return {
    _id: new mongoose.Types.ObjectId(),
    orgId: ctx.orgId,
    status: 'DRAFT',
    billDiscountType: 'flat',
    billDiscountValue: 0,
    approval: { status: 'NONE' },
    createdBy: ctx.userId,
    lines: [],
    ...fields,
  };
}

// "New sale" on the Bills page: an empty draft at the selected branch for selling products (Inventory add-on).
// customerId: null sells to "Guest", only if the salon allows it in Billing settings.
export async function createSaleDraft(ctx, { customerId }) {
  if (!hasInventory(ctx)) throw new AppError(403, 'ADDON_DISABLED', 'Selling products needs the Inventory add-on');
  const settings = await getBillingSettings(ctx);
  let customerSnapshot = { name: 'Guest' };
  if (customerId) {
    const customer = await Customer.findOne(scoped(ctx, { _id: customerId })).select('name phone').lean();
    if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
    customerSnapshot = { name: customer.name, phone: customer.phone };
  } else if (!settings.guestProductSales) {
    throw new AppError(400, 'CUSTOMER_REQUIRED', 'Choose a customer. Sales to guests are switched off in Billing settings.');
  }
  const draft = newDraft(ctx, { branchId: ctx.activeBranchId, customerId: customerId ?? null, customerSnapshot });
  const { fields } = await priceDraft(ctx, draft, {}, { settings });
  const [created] = await Invoice.create([{ ...draft, ...fields }]);
  return present(ctx, created.toObject(), { settings });
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
      { action: 'billing.price_changed', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Changed the price of ${c.name} on ${invoice.customerSnapshot?.name}'s bill from ${formatMoney(c.from)} to ${formatMoney(c.to)}${c.reason ? ` (${c.reason})` : ''}`, before: { unitPrice: c.from }, after: { unitPrice: c.to, reason: c.reason } },
      session
    );
  }
  return updated;
}

export async function saveDraft(ctx, id, { version, ...edits }) {
  const invoice = await loadInvoice(ctx, id);
  assertDraft(invoice);
  assertVersion(invoice, version);
  const { fields, priceChanges, settings } = await priceDraft(ctx, invoice, edits);
  const updated = await mongoose.connection.transaction((session) => saveChanges(ctx, invoice, fields, priceChanges, session));
  return present(ctx, updated, { settings });
}

// A draft nobody needs (e.g. a sale the customer walked away from). It has no number, so nothing is lost.
export async function discardDraft(ctx, id, { version }) {
  const invoice = await loadInvoice(ctx, id);
  assertDraft(invoice);
  const removed = await Invoice.deleteOne(scoped(ctx, { _id: invoice._id, status: 'DRAFT', version }));
  if (removed.deletedCount !== 1) throw stale();
  return { discarded: true };
}

// ---------------------------------------------------------------------------
// Products on a draft (Inventory add-on): retail products with a selling price, sold in whole stock units
// ---------------------------------------------------------------------------
async function findSellable(ctx, skuId, branchId) {
  const sku = await InventorySku.findOne(scoped(ctx, { _id: skuId })).lean();
  if (!sku) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  if (sku.type !== 'RETAIL' || sku.sellPrice == null || isMeasured(sku) || sku.status !== 'active') {
    throw new AppError(400, 'NOT_FOR_SALE', `${sku.name} isn’t for sale. An owner can set it up as a retail product with a selling price.`);
  }
  if (!(await InventorySkuBranch.exists(scoped(ctx, { skuId: sku._id, branchId, active: true })))) throw new AppError(400, 'NOT_FOR_SALE', `${sku.name} isn’t stocked at this branch`);
  return sku;
}

// Search what can be sold at the selected branch (name, brand, code, or a scanned barcode), with the stock in the store
export async function listSellableProducts(ctx, { search }) {
  if (!hasInventory(ctx)) throw new AppError(403, 'ADDON_DISABLED', 'Selling products needs the Inventory add-on');
  const branchId = ctx.activeBranchId;
  const here = await InventorySkuBranch.find(scoped(ctx, { branchId, active: true })).distinct('skuId');
  const filter = scoped(ctx, { _id: { $in: here }, type: 'RETAIL', status: 'active', sellPrice: { $ne: null }, wayOfUse: { $ne: 'SERVICE_MEASURED' } });
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: pattern }, { brand: pattern }, { code: new RegExp(`^${escapeRegex(search)}`, 'i') }, { barcodes: search }];
  }
  const skus = await InventorySku.find(filter).select('name brand code barcodes sellPrice taxRateBps hsnCode stockUnit images').sort({ name: 1 }).limit(30).lean();
  const stock = await branchStock(ctx, branchId, skus.map((s) => s._id));
  const rows = skus.map((s) => ({ _id: s._id, name: s.name, brand: s.brand, code: s.code, sellPrice: s.sellPrice, stockUnit: s.stockUnit, inStore: stock[String(s._id)]?.inStore ?? 0, hasImage: s.images?.length > 0 }));
  const exact = search ? skus.filter((s) => s.barcodes?.includes(search) || s.code === search.toUpperCase()) : [];
  return { rows, exactMatchId: exact.length === 1 ? exact[0]._id : null };
}

// Adds a product to the draft (one more of it, if it's already there). Saved straight away.
export async function addProduct(ctx, id, { version, skuId, qty }) {
  if (!hasInventory(ctx)) throw new AppError(403, 'ADDON_DISABLED', 'Selling products needs the Inventory add-on');
  const invoice = await loadInvoice(ctx, id);
  assertDraft(invoice);
  assertVersion(invoice, version);
  const sku = await findSellable(ctx, skuId, invoice.branchId);

  const same = invoice.lines.find((l) => l.kind === 'PRODUCT' && String(l.skuId) === String(sku._id));
  const lines = same
    ? invoice.lines.map((l) => (l === same ? { ...l, qty: Math.min(l.qty + qty, MAX_QTY) } : l))
    : [
        ...invoice.lines,
        { _id: new mongoose.Types.ObjectId(), kind: 'PRODUCT', skuId: sku._id, name: sku.name, qty, listUnitPrice: sku.sellPrice, unitPrice: sku.sellPrice, listComboDiscount: 0, discountType: 'flat', discountValue: 0 },
      ];
  const { fields, settings } = await priceDraft(ctx, { ...invoice, lines });
  const updated = await mongoose.connection.transaction((session) => saveChanges(ctx, invoice, fields, [], session));
  return present(ctx, updated, { settings });
}

// Takes a product off the draft (services come from the appointment and stay)
export async function removeLine(ctx, id, lineId, { version }) {
  const invoice = await loadInvoice(ctx, id);
  assertDraft(invoice);
  assertVersion(invoice, version);
  const line = invoice.lines.find((l) => String(l._id) === lineId);
  if (!line) throw new AppError(404, 'NOT_FOUND', 'That line is not on this bill');
  if (!kindOf(line).removable) throw new AppError(400, 'VALIDATION_ERROR', `${line.name} was done in the appointment, so it stays on the bill. Give a discount instead.`);
  const { fields, settings } = await priceDraft(ctx, { ...invoice, lines: invoice.lines.filter((l) => l !== line) });
  const updated = await mongoose.connection.transaction((session) => saveChanges(ctx, invoice, fields, [], session));
  return present(ctx, updated, { settings });
}

// ---------------------------------------------------------------------------
// Issue the bill: number, lock, payments, advance used and products out of stock, all in one transaction.
// input: { version, payments: [{ method, amount, reference }], useAdvance (paise), keepExtraAsAdvance, ...the same changes as saveDraft }
// ---------------------------------------------------------------------------
export async function issueInvoice(ctx, id, { version, payments = [], useAdvance = 0, sources = [], keepExtraAsAdvance = false, ...edits }, key) {
  const first = await loadInvoice(ctx, id); // 404 before anything else

  const result = await runOnce(ctx, { key, operation: 'billing.invoice.issue' }, async (session) => {
    return issueInTransaction(session);
  }).catch(async (err) => {
    // Another desk used the offer a moment ago: take it off this draft (re-priced) so the desk can review and issue again
    if (err.code === 'OFFER_TAKEN') await dropOffer(ctx, id);
    throw err;
  });

  await markPayrollStale(ctx.orgId, first.branchId); // commission and per-service pay may have changed
  return result;

  async function issueInTransaction(session) {
    const invoice = await loadInvoice(ctx, id, session);
    assertDraft(invoice);
    assertVersion(invoice, version);
    if (invoice.lines.length === 0) throw new AppError(400, 'EMPTY_BILL', 'Add something to the bill first');
    for (const [, kind] of byKind(invoice.lines)) {
      if (kind.requiresAddon && !ctx.addons?.includes(kind.requiresAddon)) throw new AppError(403, 'ADDON_DISABLED', `Selling ${kind.label.toLowerCase()}s needs the ${kind.requiresAddon} add-on`);
    }

    const { fields, priceChanges, settings, limits } = await priceDraft(ctx, invoice, edits, { session });
    if (limits.needsApproval) {
      if (fields.approval.status === 'PENDING') throw new AppError(409, 'APPROVAL_PENDING', 'This discount is waiting for an owner to approve it');
      throw new AppError(409, 'APPROVAL_NEEDED', `The discount is above the front desk limit of ${limits.limitBps / 100}% (${formatMoney(limits.limitAmount)} on this bill). Ask an owner to approve it first.`);
    }
    if (fields.offer && !fields.offer.eligible) {
      throw new AppError(409, 'OFFER_NOT_ELIGIBLE', 'The occasion offer no longer applies to this bill. Remove it, or add the services it needs.');
    }
    const needsCustomer = byKind(fields.lines).find(([, kind]) => kind.needsCustomer);
    if (!invoice.customerId && needsCustomer) throw new AppError(400, 'CUSTOMER_REQUIRED', `A bill with ${needsCustomer[1].label.toLowerCase()}s needs a customer`);

    const branch = await Branch.findById(invoice.branchId).select('name address city timezone').session(session).lean();
    const billing = await branchBilling(ctx, invoice.branchId, settings, session);
    if (settings.gstRegistered && !billing.gstin) {
      throw new AppError(409, 'GSTIN_MISSING', `${branch.name} has no GSTIN yet. An owner needs to add it in Billing settings before GST bills can be issued.`);
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
    const customer = invoice.customerId ? await Customer.findOne(scoped(ctx, { _id: invoice.customerId })).select('name phone').session(session).lean() : null;
    const org = await Organization.findById(ctx.orgId).select('name').session(session).lean();

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

    // What each kind of line does on issue, in the same transaction (products leave the store, exactly once)
    await runHook('onIssue', ctx, issued.lines, { invoice: issued }, session);
    // The occasion offer is used now (two desks can never both use it; any failure below leaves it unused)
    if (issued.offer) await redeemOffer(ctx, issued, issued.offer, session);

    // Payments and advance; a bill that ends up fully paid (or costs nothing) earns the stylists' commission
    const { invoice: final, advanceKept } = await applyPayments(ctx, issued, payments, { session, source: 'CHECKOUT', timezone: branch.timezone, advance: useAdvance, sources, keepExtraAsAdvance });

    const paid = final.amountPaid;
    const money = paid >= final.grandTotal ? 'paid in full' : paid > 0 ? `paid ${formatMoney(paid)}, ${formatMoney(final.balanceDue)} due` : 'nothing paid yet';
    const extras = [useAdvance > 0 && `${formatMoney(useAdvance)} from advance`, advanceKept > 0 && `${formatMoney(advanceKept)} kept as advance`].filter(Boolean);
    await logActivity(
      ctx,
      {
        action: 'billing.bill_issued',
        branchId: invoice.branchId,
        invoiceId: invoice._id,
        summary: `Issued bill ${final.invoiceNumber} for ${final.customerSnapshot?.name}: ${formatMoney(final.grandTotal)} (${money}${extras.length ? `; ${extras.join(', ')}` : ''})`,
        after: { invoiceNumber: final.invoiceNumber, grandTotal: final.grandTotal, amountPaid: paid, manualDiscount: final.manualDiscount, advanceUsed: useAdvance, advanceKept },
      },
      session
    );
    return present(ctx, final, { session, settings });
  }
}

// Takes the occasion offer off a draft and re-prices it (after OFFER_TAKEN)
async function dropOffer(ctx, id) {
  const invoice = await loadInvoice(ctx, id);
  if (invoice.status !== 'DRAFT' || !invoice.offer) return;
  const { fields } = await priceDraft(ctx, { ...invoice, offer: null });
  await Invoice.updateOne(scoped(ctx, { _id: invoice._id, status: 'DRAFT', version: invoice.version }), { $set: { ...fields, offer: null }, $inc: { version: 1 } });
}

// ---------------------------------------------------------------------------
// Void: an owner cancels an issued bill that has no money on it and no refunds (e.g. made by mistake).
// The number stays used (the bill shows as Void), products go back to the store and the appointment
// can be checked out again.
// ---------------------------------------------------------------------------
export async function voidInvoice(ctx, id, { reason }, key) {
  const first = await loadInvoice(ctx, id);
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).voidBills) throw new AppError(403, 'FORBIDDEN', 'Only an owner can void a bill');
  if (!reason?.trim()) throw new AppError(400, 'REASON_REQUIRED', 'Say why the bill is voided');

  const result = await runOnce(ctx, { key, operation: 'billing.invoice.void' }, async (session) => {
    const invoice = await loadInvoice(ctx, id, session);
    if (invoice.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', invoice.status === 'VOID' ? 'This bill is already void' : 'Only issued bills can be voided');
    if (invoice.amountPaid > 0) throw new AppError(409, 'HAS_PAYMENTS', `${formatMoney(invoice.amountPaid)} has been paid on this bill. Reverse the payments (or refund) first.`);
    if ((invoice.refundStatus ?? 'NONE') !== 'NONE' || (await Refund.exists({ invoiceId: invoice._id, status: 'REQUESTED' }).session(session))) {
      throw new AppError(409, 'HAS_REFUNDS', 'This bill has refunds, so it can’t be voided');
    }

    const updated = await Invoice.findOneAndUpdate(
      { _id: invoice._id, status: 'ISSUED', version: invoice.version },
      {
        $set: { status: 'VOID', voidedAt: new Date(), voidedBy: ctx.userId, voidReason: reason.trim(), balanceDue: 0, voidedAppointmentId: invoice.appointmentId },
        $unset: { appointmentId: '' },
        $inc: { version: 1 },
      },
      { returnDocument: 'after', session }
    ).lean();
    if (!updated) throw stale();
    if (invoice.appointmentId) await Appointment.updateOne({ _id: invoice.appointmentId, invoiceId: invoice._id }, { $set: { invoiceId: null } }, { session });

    await runHook('onVoid', ctx, invoice.lines, { invoice }, session); // e.g. products back into the store
    await restoreOffer(ctx, invoice, session); // an occasion offer can be used again if its month isn't over
    const branch = await Branch.findById(invoice.branchId).select('timezone').session(session).lean();
    await reverseCommissions({ invoice, eventKey: `void:${invoice._id}`, day: todayInZone(branch.timezone) }, session);

    await logActivity(ctx, { action: 'billing.bill_voided', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Voided bill ${invoice.invoiceNumber} for ${invoice.customerSnapshot?.name} (${formatMoney(invoice.grandTotal)}): ${reason.trim()}`, before: { status: 'ISSUED' }, after: { status: 'VOID', reason: reason.trim() } }, session);
    return present(ctx, updated, { session, settings });
  });
  await markPayrollStale(ctx.orgId, first.branchId);
  return result;
}

// ---------------------------------------------------------------------------
// Bill history (who did what to it, oldest first) and the customer's link to the PDF
// ---------------------------------------------------------------------------
export async function invoiceHistory(ctx, id) {
  const invoice = await loadInvoice(ctx, id);
  // Rows saved before bills were linked in the log are found by the bill number in their sentence
  const older = invoice.invoiceNumber ? [{ invoiceId: null, action: /^billing\./, branchId: invoice.branchId, summary: new RegExp(escapeRegex(invoice.invoiceNumber)) }] : [];
  const items = await ActivityLog.find(scoped(ctx, { $or: [{ invoiceId: invoice._id }, ...older] }))
    .sort({ createdAt: 1 })
    .select('action summary actorName actorRole createdAt')
    .lean();
  return { items };
}

// A link the customer can open without logging in (valid SHARE_DAYS days). Only issued bills.
export async function shareInvoice(ctx, id) {
  const invoice = await loadInvoice(ctx, id);
  if (invoice.status !== 'ISSUED') throw new AppError(409, 'NOT_ISSUED', 'Only issued bills can be shared');
  await logActivity(ctx, { action: 'billing.bill_shared', branchId: invoice.branchId, invoiceId: invoice._id, summary: `Made a link to send bill ${invoice.invoiceNumber} to ${invoice.customerSnapshot?.name}` });
  return { token: makeShareToken(invoice), days: SHARE_DAYS, phone: invoice.customerSnapshot?.phone ?? null };
}

// The bill behind a shared link (no login): only that bill, only while the link is valid
export async function sharedInvoice(token) {
  const { invoiceId, orgId } = readShareToken(token);
  const invoice = await Invoice.findOne({ _id: invoiceId, orgId, status: { $in: ['ISSUED', 'VOID'] } }).lean();
  if (!invoice) throw new AppError(404, 'NOT_FOUND', 'This bill link is not valid or has expired. Ask the salon for a new one.');
  const ctx = { orgId, role: 'PUBLIC', allowedBranchIds: [String(invoice.branchId)] };
  return present(ctx, invoice);
}

// ---------------------------------------------------------------------------
// Discount approval: the front desk asks, an owner of the branch approves or says no.
// ---------------------------------------------------------------------------
export async function requestApproval(ctx, id, { version, note, ...edits }, key) {
  await loadInvoice(ctx, id);
  return runOnce(ctx, { key, operation: 'billing.discount.request' }, async (session) => {
    const invoice = await loadInvoice(ctx, id, session);
    assertDraft(invoice);
    assertVersion(invoice, version);
    const { fields, priceChanges, settings, limits } = await priceDraft(ctx, invoice, edits, { session });
    if (!limits.needsApproval) throw new AppError(400, 'NO_APPROVAL_NEEDED', 'This discount doesn’t need an owner’s approval. You can issue the bill.');
    if (fields.approval.status === 'PENDING') throw new AppError(409, 'APPROVAL_PENDING', 'This discount is already waiting for an owner to approve it');

    const approval = { status: 'PENDING', requestedBy: ctx.userId, requestedByName: ctx.userName, requestedAt: new Date(), requestedDiscount: fields.manualDiscount, note: note?.trim() || undefined };
    const updated = await saveChanges(ctx, invoice, { ...fields, approval }, priceChanges, session);
    const summary = `Asked to approve a ${formatMoney(fields.manualDiscount)} discount on ${invoice.customerSnapshot?.name}'s bill (limit ${formatMoney(limits.limitAmount)})`;
    await logActivity(ctx, { action: 'billing.discount_requested', branchId: invoice.branchId, invoiceId: invoice._id, summary, after: approval }, session);
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
    assertVersion(invoice, version);
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
    await logActivity(ctx, { action: approve ? 'billing.discount_approved' : 'billing.discount_rejected', branchId: invoice.branchId, invoiceId: invoice._id, summary, after: approval }, session);
    await notify(ctx, [invoice.approval.requestedBy], { message: `${ctx.userName}: ${summary}`, link: LINK(invoice) }, session);
    return present(ctx, updated, { session });
  });
}

export const approveDiscount = (ctx, id, input, key) => decide(ctx, id, input, key, true);
export const rejectDiscount = (ctx, id, input, key) => decide(ctx, id, input, key, false);

// ---------------------------------------------------------------------------
// Bills list: search by number, customer name or phone; filter by dates, status and branch.
// status: DRAFT | UNPAID | PARTIALLY_PAID | PAID | DUE (anything still owed) | REFUNDED | VOID.
// Dates are in each branch's own time.
// ---------------------------------------------------------------------------
const PAGE_SIZE = 25;

export async function listInvoices(ctx, { search, status, branchId, from, to, page }) {
  const ids = branchId === 'all' ? ctx.allowedBranchIds : [branchId ?? ctx.activeBranchId];
  if (!ids.every((id) => ctx.allowedBranchIds.includes(id))) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  const branches = await Branch.find(scoped(ctx, { _id: { $in: ids } })).select('timezone').lean();

  // aggregate() doesn't turn text ids into ObjectIds like find() does, so the salon id is converted here
  const and = [{ orgId: new mongoose.Types.ObjectId(ctx.orgId), branchId: { $in: branches.map((b) => b._id) } }];
  if (status === 'DRAFT' || status === 'VOID') and.push({ status });
  else if (status === 'DUE') and.push({ status: 'ISSUED', balanceDue: { $gt: 0 } });
  else if (status === 'REFUNDED') and.push({ status: 'ISSUED', refundStatus: { $in: ['PARTIAL', 'FULL'] } });
  else if (status) and.push({ status: 'ISSUED', settlementStatus: status });
  else and.push({ status: { $in: ['DRAFT', 'ISSUED', 'VOID'] } });

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
      .select('invoiceNumber status settlementStatus refundStatus customerSnapshot grandTotal creditedTotal amountPaid refundedTotal balanceDue issuedAt createdAt branchId appointmentId approval.status')
      .populate('branchId', 'name timezone')
      .sort({ createdAt: -1 })
      .skip((page - 1) * PAGE_SIZE)
      .limit(PAGE_SIZE)
      .lean(),
    Invoice.countDocuments(filter),
    Invoice.aggregate([
      { $match: { $and: [...and, { status: 'ISSUED' }] } },
      {
        $group: {
          _id: null,
          billed: { $sum: { $subtract: ['$grandTotal', { $ifNull: ['$creditedTotal', 0] }] } },
          paid: { $sum: { $subtract: ['$amountPaid', { $ifNull: ['$refundedTotal', 0] }] } },
          due: { $sum: '$balanceDue' },
          count: { $sum: 1 },
        },
      },
    ]),
  ]);
  const totals = sums[0] ?? { billed: 0, paid: 0, due: 0, count: 0 };
  return { rows, page, pages: Math.max(Math.ceil(total / PAGE_SIZE), 1), total, totals: { billed: totals.billed, paid: totals.paid, due: totals.due, issued: totals.count } };
}
