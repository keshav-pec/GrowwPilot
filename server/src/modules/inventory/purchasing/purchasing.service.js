import {
  Branch,
  Counter,
  InventoryGoodsReceipt,
  InventoryLocation,
  InventoryPurchaseOrder,
  InventorySku,
  InventorySkuBranch,
  InventorySupplier,
  User,
} from '../../../models/index.js';
import { OPEN_PO_STATUSES } from '../../../models/inventory/InventoryPurchaseOrder.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { formatAmount } from '../../../utils/money.js';
import { todayInZone } from '../../../utils/time.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { notify } from '../../notifications/notifications.service.js';
import { branchCode } from '../../invoices/invoices.service.js';
import { assertCan, can } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { postMovement } from '../stock/stock.engine.js';
import { availableToIssue, branchStock } from '../stock/stock.queries.js';
import { ensureBranchLocations } from '../locations/locations.service.js';
import { findSupplier } from '../suppliers/suppliers.service.js';
import { describeQty } from '../units.js';

// ---------------------------------------------------------------------------
// Purchasing (INV-11, INV-12): purchase orders, receiving, returns to suppliers and reorder suggestions.
// Quantities are in each product's counting unit; prices are per stock unit (per bottle), in paise.
// Only people who may see costs see or type prices.
// ---------------------------------------------------------------------------

const SKU_FIELDS = 'name code stockUnit wayOfUse baseUnit unitsPerStockUnit status';
const ordersLink = (id) => `/app/inventory?tab=purchasing${id ? `&order=${id}` : ''}`;
const me = (ctx) => ({ id: ctx.userId, name: ctx.userName });

async function access(ctx, branchId = ctx.activeBranchId) {
  const settings = await getBranchSettings(ctx, branchId);
  return { settings, canSeeCosts: can(ctx, 'inventory.viewCosts', { settings }).allowed };
}

async function skusById(ctx, ids, session = null) {
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: ids } })).select(SKU_FIELDS).session(session).lean();
  return Object.fromEntries(skus.map((s) => [String(s._id), s]));
}

// The order's value, when every line has a price (lines are counted in units, prices are per stock unit)
function orderTotal(lines, skuOf) {
  if (lines.some((l) => l.unitCost == null)) return null;
  return Math.round(lines.reduce((sum, l) => sum + (l.qty / skuOf[String(l.skuId)].unitsPerStockUnit) * l.unitCost, 0));
}

function present(po, canSeeCosts, skuOf) {
  const lines = po.lines.map((l) => {
    const line = { ...l, sku: skuOf?.[String(l.skuId)] };
    if (!canSeeCosts) delete line.unitCost;
    return line;
  });
  const out = { ...po, lines };
  if (!canSeeCosts) delete out.total;
  return out;
}

async function findOrder(ctx, id, session = null) {
  const po = await InventoryPurchaseOrder.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId })).session(session).lean();
  if (!po) throw new AppError(404, 'NOT_FOUND', 'Purchase order not found');
  return po;
}

function assertStatus(po, allowed, what) {
  if (!allowed.includes(po.status)) throw new AppError(409, 'INVALID_STATUS', `This order is ${po.status.toLowerCase().replace('_', ' ')}, so it can’t be ${what}`);
}

// Checks order lines: products used at this branch, each once. Prices only from people who may see costs;
// for everyone else, prices already on the order are kept.
async function cleanLines(ctx, lines, { canSeeCosts, previous = [] }) {
  const branchId = ctx.activeBranchId;
  const ids = lines.map((l) => l.skuId);
  if (new Set(ids).size !== ids.length) throw new AppError(400, 'VALIDATION_ERROR', 'Each product can be on the order only once');
  const usedHere = await InventorySkuBranch.countDocuments(scoped(ctx, { branchId, skuId: { $in: ids }, active: true }));
  const skuOf = await skusById(ctx, ids);
  if (usedHere !== ids.length || Object.keys(skuOf).length !== ids.length) throw new AppError(404, 'NOT_FOUND', 'Product not found at this branch');
  if (!canSeeCosts && lines.some((l) => l.unitCost != null)) throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can enter prices');
  const priceBefore = Object.fromEntries(previous.map((l) => [String(l.skuId), l.unitCost]));
  return {
    skuOf,
    lines: lines.map((l) => ({
      skuId: l.skuId,
      skuName: skuOf[l.skuId].name,
      qty: l.qty,
      unitCost: canSeeCosts ? (l.unitCost ?? null) : (priceBefore[l.skuId] ?? null),
      receivedQty: 0,
    })),
  };
}

async function nextOrderNumber(ctx, branchId, session) {
  const branch = await Branch.findById(branchId).select('name').session(session).lean();
  const counter = await Counter.findOneAndUpdate({ _id: `po:${branchId}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
  return `PO-${branchCode(branch.name)}-${String(counter.seq).padStart(6, '0')}`;
}

// Owners who may approve an order of this value at this branch
async function approverIds(ctx, branchId, value, settings) {
  const owners = await User.find(scoped(ctx, { role: 'OWNER', status: 'active', $or: [{ allBranches: true }, { branchIds: branchId }] })).lean();
  return owners.filter((o) => can({ role: 'OWNER', isPrimaryOwner: o.allBranches }, 'inventory.approvePurchaseOrder', { settings, value: value ?? undefined }).allowed).map((o) => o._id);
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

export async function listOrders(ctx, { status }) {
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.view', { settings });
  const filter = scoped(ctx, { branchId: ctx.activeBranchId });
  if (status === 'open') filter.status = { $nin: ['CLOSED', 'CANCELED', 'RECEIVED'] };
  else if (status) filter.status = status;
  const orders = await InventoryPurchaseOrder.find(filter).sort({ createdAt: -1 }).limit(100).lean();
  return orders.map((po) => present(po, canSeeCosts));
}

export async function getOrder(ctx, id) {
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.view', { settings });
  const po = await findOrder(ctx, id);
  const [skuOf, receipts] = await Promise.all([
    skusById(ctx, po.lines.map((l) => l.skuId)),
    InventoryGoodsReceipt.find(scoped(ctx, { poId: po._id })).sort({ at: 1 }).lean(),
  ]);
  const approval = can(ctx, 'inventory.approvePurchaseOrder', { settings, value: po.total ?? undefined });
  return {
    order: present(po, canSeeCosts, skuOf),
    receipts: receipts.map((r) => ({ ...r, lines: r.lines.map((l) => (canSeeCosts ? l : { ...l, unitCost: undefined })) })),
    can: {
      edit: ['DRAFT', 'PENDING_APPROVAL'].includes(po.status) && can(ctx, 'inventory.createPurchaseOrder', { settings }).allowed,
      approve: po.status === 'PENDING_APPROVAL' && approval.allowed && String(po.createdBy.id) !== ctx.userId,
      receive: ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'].includes(po.status) && can(ctx, 'inventory.receive', { settings }).allowed,
      acceptMore: ctx.isPrimaryOwner, // only the business owner accepts more than was ordered
    },
  };
}

// New order, saved as a draft. input: { supplierId, lines: [{ skuId, qty, unitCost? }], expectedDate?, note? }
export async function createOrder(ctx, input, key) {
  const branchId = ctx.activeBranchId;
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.createPurchaseOrder', { settings });
  const supplier = await findSupplier(ctx, input.supplierId);
  const { lines, skuOf } = await cleanLines(ctx, input.lines, { canSeeCosts });

  return runOnce(ctx, { key, operation: 'inventory.po.create' }, async (session) => {
    const [po] = await InventoryPurchaseOrder.create(
      [
        {
          orgId: ctx.orgId,
          branchId,
          number: await nextOrderNumber(ctx, branchId, session),
          supplierId: supplier._id,
          supplierName: supplier.name,
          lines,
          total: orderTotal(lines, skuOf),
          expectedDate: input.expectedDate ?? null,
          note: input.note,
          createdBy: me(ctx),
        },
      ],
      { session }
    );
    return { order: present(po.toObject(), canSeeCosts, skuOf) };
  });
}

// Change a draft (or an order waiting for approval). input: { version, supplierId?, lines?, expectedDate?, note? }
export async function updateOrder(ctx, id, input, key) {
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.createPurchaseOrder', { settings });
  const po = await findOrder(ctx, id);
  assertStatus(po, ['DRAFT', 'PENDING_APPROVAL'], 'changed');
  const changes = {};
  if (input.supplierId) {
    const supplier = await findSupplier(ctx, input.supplierId);
    Object.assign(changes, { supplierId: supplier._id, supplierName: supplier.name });
  }
  if (input.lines) {
    const { lines, skuOf } = await cleanLines(ctx, input.lines, { canSeeCosts, previous: po.lines });
    Object.assign(changes, { lines, total: orderTotal(lines, skuOf) });
  }
  if (input.expectedDate !== undefined) changes.expectedDate = input.expectedDate;
  if (input.note !== undefined) changes.note = input.note;

  return runOnce(ctx, { key, operation: 'inventory.po.update' }, async (session) => {
    const updated = await InventoryPurchaseOrder.findOneAndUpdate(scoped(ctx, { _id: po._id, version: input.version }), { $set: changes, $inc: { version: 1 } }, { returnDocument: 'after', session }).lean();
    if (!updated) throw new AppError(409, 'STALE_VERSION', 'Someone else changed this order. Open it again to see the latest.');
    return { order: present(updated, canSeeCosts) };
  });
}

// Send a draft on: approved straight away when within the person's limit, otherwise waiting for an owner.
// Orders from an inventory login always wait; a branch owner's order above their limit goes to the business owner.
export async function submitOrder(ctx, id, key) {
  const { settings, canSeeCosts } = await access(ctx);
  const create = assertCan(ctx, 'inventory.createPurchaseOrder', { settings });
  const po = await findOrder(ctx, id);
  assertStatus(po, ['DRAFT'], 'sent');
  if (po.lines.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Add at least one product');
  const approvedNow = !create.needsApproval && can(ctx, 'inventory.approvePurchaseOrder', { settings, value: po.total ?? undefined }).allowed;

  return runOnce(ctx, { key, operation: 'inventory.po.submit' }, async (session) => {
    const now = new Date();
    const changes = approvedNow ? { status: 'APPROVED', submittedAt: now, approvedBy: me(ctx), approvedAt: now } : { status: 'PENDING_APPROVAL', submittedAt: now };
    const updated = await InventoryPurchaseOrder.findOneAndUpdate(scoped(ctx, { _id: po._id, status: 'DRAFT' }), { $set: changes, $inc: { version: 1 } }, { returnDocument: 'after', session }).lean();
    if (!updated) throw new AppError(409, 'STALE_VERSION', 'This order was just changed. Open it again.');
    const value = po.total != null ? ` (${formatAmount(po.total)})` : '';
    if (approvedNow) {
      await recordInventoryAction(ctx, { action: 'inventory.po_approved', branchId: po.branchId, summary: `Approved ${po.number} from ${po.supplierName}${value}`, link: ordersLink(po._id) }, session);
    } else {
      await notify(ctx, await approverIds(ctx, po.branchId, po.total, settings), { message: `${ctx.userName} asks to approve ${po.number} from ${po.supplierName}${value}`, link: ordersLink(po._id) }, session);
    }
    return { order: present(updated, canSeeCosts) };
  });
}

// An owner approves (or sends back) an order waiting for approval
export async function decideOrder(ctx, id, { approve, note }, key) {
  const { settings, canSeeCosts } = await access(ctx);
  const po = await findOrder(ctx, id);
  assertStatus(po, ['PENDING_APPROVAL'], 'approved');
  if (String(po.createdBy.id) === ctx.userId) throw new AppError(403, 'PERMISSION_DENIED', 'Someone else has to approve your own order');
  if (!can(ctx, 'inventory.approvePurchaseOrder', { settings, value: po.total ?? undefined }).allowed) {
    throw new AppError(403, 'PERMISSION_DENIED', 'This order is above your approval limit. The business owner decides.');
  }

  return runOnce(ctx, { key, operation: 'inventory.po.decide' }, async (session) => {
    const changes = approve ? { status: 'APPROVED', approvedBy: me(ctx), approvedAt: new Date(), decisionNote: note } : { status: 'DRAFT', decisionNote: note };
    const updated = await InventoryPurchaseOrder.findOneAndUpdate(scoped(ctx, { _id: po._id, status: 'PENDING_APPROVAL' }), { $set: changes, $inc: { version: 1 } }, { returnDocument: 'after', session }).lean();
    if (!updated) throw new AppError(409, 'ALREADY_DECIDED', 'This order has already been decided');
    const verb = approve ? 'Approved' : 'Sent back';
    await recordInventoryAction(ctx, { action: approve ? 'inventory.po_approved' : 'inventory.po_sent_back', branchId: po.branchId, summary: `${verb} ${po.number} from ${po.supplierName}${note ? `: ${note}` : ''}`, link: ordersLink(po._id) }, session);
    await notify(ctx, [po.createdBy.id], { message: `${ctx.userName} ${verb.toLowerCase()} ${po.number}${note ? `: ${note}` : ''}`, link: ordersLink(po._id) }, session);
    return { order: present(updated, canSeeCosts) };
  });
}

// Simple status steps: placed with the supplier, cancelled, or closed (whatever is still missing won't come)
const STEPS = {
  order: { from: ['APPROVED'], to: 'ORDERED', stamp: 'orderedAt', what: 'marked as ordered', words: 'Placed' },
  cancel: { from: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'], to: 'CANCELED', stamp: 'cancelledAt', what: 'cancelled', words: 'Cancelled' },
  close: { from: ['PARTIALLY_RECEIVED', 'RECEIVED'], to: 'CLOSED', stamp: 'closedAt', what: 'closed', words: 'Closed' },
};

export async function moveOrder(ctx, id, step, { note } = {}, key) {
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.createPurchaseOrder', { settings });
  const rule = STEPS[step];
  const po = await findOrder(ctx, id);
  assertStatus(po, rule.from, rule.what);
  if (step === 'cancel' && po.lines.some((l) => l.receivedQty > 0)) throw new AppError(409, 'INVALID_STATUS', 'Part of this order has arrived. Close it instead.');

  return runOnce(ctx, { key, operation: `inventory.po.${step}` }, async (session) => {
    const updated = await InventoryPurchaseOrder.findOneAndUpdate(
      scoped(ctx, { _id: po._id, status: po.status }),
      { $set: { status: rule.to, [rule.stamp]: new Date(), ...(note && { decisionNote: note }) }, $inc: { version: 1 } },
      { returnDocument: 'after', session }
    ).lean();
    if (!updated) throw new AppError(409, 'STALE_VERSION', 'This order was just changed. Open it again.');
    await recordInventoryAction(ctx, { action: `inventory.po_${step}`, branchId: po.branchId, summary: `${rule.words} ${po.number} from ${po.supplierName}${note ? `: ${note}` : ''}`, link: ordersLink(po._id) }, session);
    return { order: present(updated, canSeeCosts) };
  });
}

// ---------------------------------------------------------------------------
// Receiving (INV-12): only what physically arrived goes into the store and updates the average cost.
// Part deliveries are fine. More than was ordered needs the business owner, with a reason.
// input: { invoiceNumber?, locationId?, overReceiptReason?, lines: [{ lineId, qty, unitCost?, batch?, expiryDate? }] }
// ---------------------------------------------------------------------------
export async function receiveOrder(ctx, id, input, key) {
  const branchId = ctx.activeBranchId;
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.receive', { settings });
  const po = await findOrder(ctx, id);
  assertStatus(po, ['APPROVED', 'ORDERED', 'PARTIALLY_RECEIVED'], 'received');
  if (!canSeeCosts && input.lines.some((l) => l.unitCost != null)) throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can enter prices');
  const { mainStore } = await ensureBranchLocations(ctx, branchId);
  const store = await storeOrMain(ctx, branchId, input.locationId, mainStore);
  const skuOf = await skusById(ctx, po.lines.map((l) => l.skuId));

  const lineOf = Object.fromEntries(po.lines.map((l) => [String(l._id), l]));
  const arrived = input.lines.filter((l) => l.qty > 0);
  if (arrived.length === 0) throw new AppError(400, 'VALIDATION_ERROR', 'Enter how many arrived');
  let over = false;
  for (const l of arrived) {
    const line = lineOf[l.lineId];
    if (!line) throw new AppError(404, 'NOT_FOUND', 'Order line not found');
    if (line.receivedQty + l.qty > line.qty) over = true;
  }
  let overReceipt;
  if (over) {
    if (!ctx.isPrimaryOwner) throw new AppError(403, 'OVER_RECEIPT', 'More than was ordered arrived. Only the business owner can accept it; receive what was ordered for now.');
    if (!input.overReceiptReason) throw new AppError(400, 'NOTE_REQUIRED', 'More than was ordered: say why you are accepting it');
    overReceipt = { reason: input.overReceiptReason, approvedBy: me(ctx) };
  }

  return runOnce(ctx, { key, operation: 'inventory.po.receive' }, async (session) => {
    const lines = po.lines.map((line) => {
      const got = arrived.find((l) => l.lineId === String(line._id));
      return got ? { ...line, receivedQty: line.receivedQty + got.qty } : line;
    });
    const status = lines.every((l) => l.receivedQty >= l.qty) ? 'RECEIVED' : 'PARTIALLY_RECEIVED';
    const updated = await InventoryPurchaseOrder.findOneAndUpdate(
      scoped(ctx, { _id: po._id, version: po.version }),
      { $set: { lines, status, ...(po.status === 'APPROVED' && { orderedAt: new Date() }) }, $inc: { version: 1 } },
      { returnDocument: 'after', session }
    ).lean();
    if (!updated) throw new AppError(409, 'STALE_VERSION', 'Someone else just received or changed this order. Open it again.');

    const received = arrived.map((l) => {
      const line = lineOf[l.lineId];
      return { poLineId: line._id, skuId: line.skuId, skuName: line.skuName, qty: l.qty, unitCost: canSeeCosts && l.unitCost != null ? l.unitCost : line.unitCost, batch: l.batch, expiryDate: l.expiryDate };
    });
    const { transaction } = await postReceipt(ctx, { branchId, store, lines: received, skuOf, note: `${po.number}${input.invoiceNumber ? `, invoice ${input.invoiceNumber}` : ''}`, reference: { kind: 'purchase_order', id: po._id }, key }, session);
    await InventoryGoodsReceipt.create(
      [{ orgId: ctx.orgId, branchId, poId: po._id, poNumber: po.number, supplierId: po.supplierId, supplierName: po.supplierName, invoiceNumber: input.invoiceNumber, locationId: store._id, lines: received, overReceipt, transactionId: transaction._id, by: me(ctx) }],
      { session }
    );
    const what = received.map((l) => `${describeQty(l.qty, skuOf[String(l.skuId)])} ${l.skuName}`).join(', ');
    await recordInventoryAction(
      ctx,
      { action: 'inventory.po_received', branchId, summary: `Received ${what} on ${po.number}${overReceipt ? ` (more than ordered: ${overReceipt.reason})` : ''}`, link: ordersLink(po._id) },
      session
    );
    return { order: present(updated, canSeeCosts), transactionId: transaction._id };
  });
}

async function storeOrMain(ctx, branchId, locationId, mainStore) {
  if (!locationId) return mainStore;
  const store = await InventoryLocation.findOne(scoped(ctx, { _id: locationId, branchId, kind: 'STORE', active: true })).lean();
  if (!store) throw new AppError(404, 'NOT_FOUND', 'Store not found');
  return store;
}

// The RECEIPT movement: into the store, at the price paid (per counting unit), which updates the average cost
function postReceipt(ctx, { branchId, store, lines, skuOf, note, reference, key }, session) {
  return postMovement(
    ctx,
    {
      branchId,
      type: 'RECEIPT',
      note,
      reference,
      requestKey: key,
      lines: lines.map((l) => ({
        skuId: l.skuId,
        locationId: store._id,
        qty: l.qty,
        unitCost: l.unitCost == null ? null : l.unitCost / skuOf[String(l.skuId)].unitsPerStockUnit,
        bucket: 'RECEIVED',
      })),
    },
    session
  );
}

// A delivery without an order. input: { supplierId?, invoiceNumber?, locationId?, lines: [{ skuId, qty, unitCost?, batch?, expiryDate? }] }
export async function directReceipt(ctx, input, key) {
  const branchId = ctx.activeBranchId;
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.directReceipt', { settings });
  const supplier = input.supplierId ? await findSupplier(ctx, input.supplierId) : null;
  const { lines, skuOf } = await cleanLines(ctx, input.lines, { canSeeCosts });
  const { mainStore } = await ensureBranchLocations(ctx, branchId);
  const store = await storeOrMain(ctx, branchId, input.locationId, mainStore);
  const received = lines.map((l, i) => ({ skuId: l.skuId, skuName: l.skuName, qty: l.qty, unitCost: l.unitCost, batch: input.lines[i].batch, expiryDate: input.lines[i].expiryDate }));

  return runOnce(ctx, { key, operation: 'inventory.receipt.direct' }, async (session) => {
    const { transaction } = await postReceipt(ctx, { branchId, store, lines: received, skuOf, note: input.invoiceNumber ? `Invoice ${input.invoiceNumber}` : undefined, key }, session);
    const [receipt] = await InventoryGoodsReceipt.create(
      [{ orgId: ctx.orgId, branchId, supplierId: supplier?._id, supplierName: supplier?.name, invoiceNumber: input.invoiceNumber, locationId: store._id, lines: received, transactionId: transaction._id, by: me(ctx) }],
      { session }
    );
    const what = received.map((l) => `${describeQty(l.qty, skuOf[String(l.skuId)])} ${l.skuName}`).join(', ');
    await recordInventoryAction(ctx, { action: 'inventory.received', branchId, summary: `Received ${what} without an order${supplier ? ` from ${supplier.name}` : ''}`, link: ordersLink() }, session);
    return { receiptId: receipt._id, transactionId: transaction._id };
  });
}

// Return to supplier: its own outgoing movement, from a store. input: { supplierId, locationId?, poId?, reason, lines: [{ skuId, qty }] }
export async function returnToSupplier(ctx, input, key) {
  const branchId = ctx.activeBranchId;
  const { settings } = await access(ctx);
  assertCan(ctx, 'inventory.returnToSupplier', { settings });
  const supplier = await findSupplier(ctx, input.supplierId);
  const po = input.poId ? await findOrder(ctx, input.poId) : null;
  const { lines, skuOf } = await cleanLines(ctx, input.lines, { canSeeCosts: true });
  const { mainStore } = await ensureBranchLocations(ctx, branchId);
  const store = await storeOrMain(ctx, branchId, input.locationId, mainStore);

  return runOnce(ctx, { key, operation: 'inventory.receipt.return' }, async (session) => {
    const { transaction } = await postMovement(
      ctx,
      {
        branchId,
        type: 'RETURN_TO_SUPPLIER',
        note: `${supplier.name}: ${input.reason}`,
        reference: po ? { kind: 'purchase_order', id: po._id } : undefined,
        requestKey: key,
        lines: lines.map((l) => ({ skuId: l.skuId, locationId: store._id, qty: -l.qty, bucket: 'RETURNED' })),
      },
      session
    );
    await InventoryGoodsReceipt.create(
      [{ orgId: ctx.orgId, branchId, kind: 'RETURN', poId: po?._id, poNumber: po?.number, supplierId: supplier._id, supplierName: supplier.name, locationId: store._id, lines: lines.map((l) => ({ skuId: l.skuId, skuName: l.skuName, qty: l.qty })), reason: input.reason, transactionId: transaction._id, by: me(ctx) }],
      { session }
    );
    const what = lines.map((l) => `${describeQty(l.qty, skuOf[String(l.skuId)])} ${l.skuName}`).join(', ');
    await recordInventoryAction(ctx, { action: 'inventory.returned_to_supplier', branchId, summary: `Returned ${what} to ${supplier.name}: ${input.reason}`, link: ordersLink() }, session);
    return { transactionId: transaction._id };
  });
}

// Recent deliveries and returns at the selected branch
export async function listReceipts(ctx) {
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.view', { settings });
  const receipts = await InventoryGoodsReceipt.find(scoped(ctx, { branchId: ctx.activeBranchId })).sort({ at: -1 }).limit(50).lean();
  return receipts.map((r) => ({ ...r, lines: r.lines.map((l) => (canSeeCosts ? l : { ...l, unitCost: undefined })) }));
}

// ---------------------------------------------------------------------------
// Reorder suggestions: products whose available stock (store only) plus what is already on approved orders
// is at or below the reorder point (AC30). Grouped by each product's usual supplier.
// ---------------------------------------------------------------------------
export async function suggestions(ctx) {
  const branchId = ctx.activeBranchId;
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.createPurchaseOrder', { settings });
  const rows = await InventorySkuBranch.find(scoped(ctx, { branchId, active: true, reorderPoint: { $ne: null } })).lean();
  const skuOf = await skusById(ctx, rows.map((r) => r.skuId));
  const live = rows.filter((r) => skuOf[String(r.skuId)]?.status === 'active');
  const [stock, openOrders, suppliers, branch] = await Promise.all([
    branchStock(ctx, branchId, live.map((r) => r.skuId)),
    InventoryPurchaseOrder.find(scoped(ctx, { branchId, status: { $in: OPEN_PO_STATUSES } })).select('lines').lean(),
    InventorySupplier.find(scoped(ctx)).lean(),
    Branch.findById(branchId).select('timezone').lean(),
  ]);
  const onOrder = {};
  for (const po of openOrders) for (const l of po.lines) onOrder[String(l.skuId)] = (onOrder[String(l.skuId)] ?? 0) + Math.max(l.qty - l.receivedQty, 0);
  const supplierOf = Object.fromEntries(suppliers.map((s) => [String(s._id), s]));
  const today = todayInZone(branch.timezone);

  const list = [];
  for (const row of live) {
    const sku = skuOf[String(row.skuId)];
    const { inStore, inUse } = stock[String(row.skuId)];
    const available = availableToIssue({ inStore });
    const coming = onOrder[String(row.skuId)] ?? 0;
    if (available + coming > row.reorderPoint) continue;
    // Enough to get back above the reorder point (at least the usual order quantity), in whole stock units
    const needed = Math.max(row.reorderQty ?? 0, row.reorderPoint - (available + coming) + 1);
    const per = sku.unitsPerStockUnit;
    const supplier = row.preferredSupplierId ? supplierOf[String(row.preferredSupplierId)] : null;
    const leadTimeDays = row.leadTimeDays ?? supplier?.leadTimeDays ?? null;
    list.push({
      sku,
      available,
      inUse,
      onOrder: coming,
      reorderPoint: row.reorderPoint,
      reorderQty: row.reorderQty,
      suggestedQty: Math.ceil(needed / per) * per,
      supplier: supplier ? { _id: supplier._id, name: supplier.name } : null,
      leadTimeDays,
      arrivesBy: leadTimeDays != null ? addDays(today, leadTimeDays) : null,
      ...(canSeeCosts && { lastUnitCost: row.avgCost != null ? Math.round(row.avgCost * per) : null }),
    });
  }
  // The longest wait first: those need ordering soonest
  return list.sort((a, b) => (b.leadTimeDays ?? 0) - (a.leadTimeDays ?? 0) || a.sku.name.localeCompare(b.sku.name));
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// Create a draft order per supplier from the chosen suggestions. lines: [{ skuId, qty }]
// Owners get the last known price filled in (they can change it before sending).
export async function createFromSuggestions(ctx, { lines }, key) {
  const branchId = ctx.activeBranchId;
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.createPurchaseOrder', { settings });
  const rows = await InventorySkuBranch.find(scoped(ctx, { branchId, skuId: { $in: lines.map((l) => l.skuId) }, active: true })).lean();
  const rowOf = Object.fromEntries(rows.map((r) => [String(r.skuId), r]));
  const skuOf = await skusById(ctx, lines.map((l) => l.skuId));
  const noSupplier = lines.filter((l) => !rowOf[l.skuId]?.preferredSupplierId);
  if (noSupplier.length > 0) {
    throw new AppError(400, 'NO_SUPPLIER', `Choose a usual supplier for ${noSupplier.map((l) => skuOf[l.skuId]?.name ?? 'a product').join(', ')} first (product → Edit → More details)`);
  }

  const bySupplier = new Map();
  for (const l of lines) {
    const supplierId = String(rowOf[l.skuId].preferredSupplierId);
    if (!bySupplier.has(supplierId)) bySupplier.set(supplierId, []);
    const avg = rowOf[l.skuId].avgCost;
    bySupplier.get(supplierId).push({ skuId: l.skuId, qty: l.qty, unitCost: canSeeCosts && avg != null ? Math.round(avg * skuOf[l.skuId].unitsPerStockUnit) : null });
  }
  const suppliers = await InventorySupplier.find(scoped(ctx, { _id: { $in: [...bySupplier.keys()] } })).lean();

  return runOnce(ctx, { key, operation: 'inventory.po.fromSuggestions' }, async (session) => {
    const orders = [];
    for (const supplier of suppliers) {
      const { lines: clean, skuOf: skus } = await cleanLines(ctx, bySupplier.get(String(supplier._id)), { canSeeCosts: true });
      const [po] = await InventoryPurchaseOrder.create(
        [{ orgId: ctx.orgId, branchId, number: await nextOrderNumber(ctx, branchId, session), supplierId: supplier._id, supplierName: supplier.name, lines: clean, total: orderTotal(clean, skus), createdBy: me(ctx) }],
        { session }
      );
      orders.push(present(po.toObject(), canSeeCosts));
    }
    return { orders };
  });
}
