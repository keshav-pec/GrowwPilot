import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import {
  Appointment,
  Branch,
  InventoryBalance,
  InventoryConsumptionEvent,
  InventoryGoodsReceipt,
  InventoryLedgerEntry,
  InventoryLocation,
  InventoryPurchaseOrder,
  InventoryRecipe,
  InventorySku,
  InventorySkuBranch,
  InventorySupplier,
  InventoryTransaction,
} from '../../../models/index.js';
import { OPEN_PO_STATUSES } from '../../../models/inventory/InventoryPurchaseOrder.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { dayRangeUTC, todayInZone } from '../../../utils/time.js';
import { assertCan, can } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { countingUnit } from '../units.js';

// ---------------------------------------------------------------------------
// Reports (INV-14). Every report is a plain table: { title, note?, columns, rows }.
// Columns marked `cost` are removed on the server for people who may not see costs, so neither the screen
// nor the CSV export (AC27) ever gets them. Columns marked `qty` hold whole numbers in the product's
// counting unit; each row carries the product (`_sku`) so the screen can write "3 bottles + 400 ml".
// ---------------------------------------------------------------------------

const SKU_FIELDS = 'name code category stockUnit wayOfUse baseUnit unitsPerStockUnit status';
const WAY_WORDS = { FINISH: 'Finish', SERVICE_UNITS: 'Per service, units', SERVICE_MEASURED: 'Per service, by measure', MANUAL: 'By hand' };
const REASON_WORDS = { DAMAGE: 'Damaged', EXPIRY: 'Expired', LOSS: 'Lost', SPILLAGE: 'Spilled', STOCK_COUNT_CORRECTION: 'Count correction' };
const oid = (id) => new mongoose.Types.ObjectId(String(id));
const paise = (n) => (n == null ? null : Math.round(n));

const PRODUCT = { key: 'product', label: 'Product' };
const BRANCH = { key: 'branch', label: 'Branch' };
const UNIT = { key: 'unit', label: 'Counted in' };

async function skuMap(ctx, ids) {
  const skus = await InventorySku.find(scoped(ctx, { _id: { $in: ids } })).select(SKU_FIELDS).lean();
  return Object.fromEntries(skus.map((s) => [String(s._id), s]));
}

const productCells = (sku) => ({ product: sku?.name ?? '?', code: sku?.code, unit: sku ? countingUnit(sku) : '', _sku: sku });

// ---- the reports ----------------------------------------------------------

// Store, in use, available, on hand and on order, per product and branch
async function stockSummary(ctx, { branchIds, branchName }) {
  const rows = await InventorySkuBranch.find(scoped(ctx, { branchId: { $in: branchIds }, active: true })).lean();
  const [skuOf, locations, balances, orders] = await Promise.all([
    skuMap(ctx, rows.map((r) => r.skuId)),
    InventoryLocation.find(scoped(ctx, { branchId: { $in: branchIds } })).select('kind').lean(),
    InventoryBalance.find(scoped(ctx, { branchId: { $in: branchIds } })).lean(),
    InventoryPurchaseOrder.find(scoped(ctx, { branchId: { $in: branchIds }, status: { $in: OPEN_PO_STATUSES } })).select('branchId lines').lean(),
  ]);
  const kindOf = Object.fromEntries(locations.map((l) => [String(l._id), l.kind]));
  const key = (branchId, skuId) => `${branchId}:${skuId}`;
  const stock = {};
  for (const b of balances) {
    const s = (stock[key(b.branchId, b.skuId)] ??= { inStore: 0, inUse: 0 });
    if (kindOf[String(b.locationId)] === 'IN_USE') s.inUse += b.qty;
    else s.inStore += b.qty;
  }
  const onOrder = {};
  for (const po of orders) for (const l of po.lines) onOrder[key(po.branchId, l.skuId)] = (onOrder[key(po.branchId, l.skuId)] ?? 0) + Math.max(l.qty - l.receivedQty, 0);

  return {
    title: 'Stock summary',
    columns: [PRODUCT, BRANCH, UNIT, { key: 'inStore', label: 'In store', qty: true }, { key: 'inUse', label: 'In use', qty: true }, { key: 'available', label: 'Available to issue', qty: true }, { key: 'onHand', label: 'On hand', qty: true }, { key: 'onOrder', label: 'On order', qty: true }, { key: 'value', label: 'Value (₹)', cost: true, money: true }],
    rows: rows
      .filter((r) => skuOf[String(r.skuId)]?.status === 'active')
      .map((r) => {
        const { inStore = 0, inUse = 0 } = stock[key(r.branchId, r.skuId)] ?? {};
        return { ...productCells(skuOf[String(r.skuId)]), branch: branchName(r.branchId), inStore, inUse, available: inStore, onHand: inStore + inUse, onOrder: onOrder[key(r.branchId, r.skuId)] ?? 0, value: r.avgCost == null ? null : paise((inStore + inUse) * r.avgCost) };
      })
      .sort((a, b) => a.product.localeCompare(b.product)),
  };
}

// Products at or below their reorder point (on available-to-issue), with supplier, lead time and a suggested order
async function lowStock(ctx, args) {
  const summary = await stockSummary(ctx, args);
  const rows = await InventorySkuBranch.find(scoped(ctx, { branchId: { $in: args.branchIds }, active: true, reorderPoint: { $ne: null } })).lean();
  const suppliers = await InventorySupplier.find(scoped(ctx)).lean();
  const supplierOf = Object.fromEntries(suppliers.map((s) => [String(s._id), s]));
  const list = [];
  for (const r of rows) {
    const line = summary.rows.find((x) => String(x._sku?._id) === String(r.skuId) && x.branch === args.branchName(r.branchId));
    if (!line || line.available > r.reorderPoint) continue;
    const per = line._sku.unitsPerStockUnit;
    const needed = Math.max(r.reorderQty ?? 0, r.reorderPoint - (line.available + line.onOrder) + 1);
    const supplier = r.preferredSupplierId ? supplierOf[String(r.preferredSupplierId)] : null;
    list.push({ ...productCells(line._sku), branch: line.branch, available: line.available, reorderPoint: r.reorderPoint, onOrder: line.onOrder, suggested: needed > 0 ? Math.ceil(needed / per) * per : 0, supplier: supplier?.name ?? '—', leadTime: r.leadTimeDays ?? supplier?.leadTimeDays ?? null });
  }
  return {
    title: 'Low stock',
    columns: [PRODUCT, BRANCH, UNIT, { key: 'available', label: 'Available', qty: true }, { key: 'reorderPoint', label: 'Order at', qty: true }, { key: 'onOrder', label: 'On order', qty: true }, { key: 'suggested', label: 'Suggested order', qty: true }, { key: 'supplier', label: 'Supplier' }, { key: 'leadTime', label: 'Lead time (days)' }],
    rows: list.sort((a, b) => a.available - b.available),
  };
}

// Normal use (finished bottles, service use, used by hand), by product, from the store and from in use
async function useByProduct(ctx, { branchIds, range }) {
  const locations = await InventoryLocation.find(scoped(ctx, { branchId: { $in: branchIds } })).select('kind').lean();
  const inUseIds = locations.filter((l) => l.kind === 'IN_USE').map((l) => l._id);
  const grouped = await InventoryLedgerEntry.aggregate([
    { $match: { orgId: oid(ctx.orgId), branchId: { $in: branchIds.map(oid) }, bucket: 'CONSUMED', occurredAt: range } },
    {
      $group: {
        _id: '$skuId',
        fromInUse: { $sum: { $cond: [{ $in: ['$locationId', inUseIds] }, { $multiply: ['$qty', -1] }, 0] } },
        fromStore: { $sum: { $cond: [{ $in: ['$locationId', inUseIds] }, 0, { $multiply: ['$qty', -1] }] } },
        value: { $sum: { $multiply: [{ $multiply: ['$qty', -1] }, { $ifNull: ['$unitCost', 0] }] } },
      },
    },
  ]);
  const skuOf = await skuMap(ctx, grouped.map((g) => g._id));
  return {
    title: 'Use by product',
    columns: [PRODUCT, { key: 'category', label: 'Category' }, { key: 'way', label: 'Way of use' }, UNIT, { key: 'fromStore', label: 'From store', qty: true }, { key: 'fromInUse', label: 'From in use', qty: true }, { key: 'total', label: 'Total used', qty: true }, { key: 'value', label: 'Value (₹)', cost: true, money: true }],
    rows: grouped
      .map((g) => {
        const sku = skuOf[String(g._id)];
        return { ...productCells(sku), category: sku?.category, way: WAY_WORDS[sku?.wayOfUse], fromStore: g.fromStore, fromInUse: g.fromInUse, total: g.fromStore + g.fromInUse, value: paise(g.value) };
      })
      .filter((r) => r.total !== 0)
      .sort((a, b) => b.value - a.value || a.product.localeCompare(b.product)),
  };
}

// Finished bottles by who had them (stylist, station or salon floor)
async function recipientUse(ctx, { branchIds, range }) {
  const transactions = await InventoryTransaction.find(scoped(ctx, { branchId: { $in: branchIds }, type: 'FINISH', occurredAt: range })).select('heldBy').lean();
  const heldByOf = Object.fromEntries(transactions.map((t) => [String(t._id), t.heldBy]));
  const lines = await InventoryLedgerEntry.find(scoped(ctx, { transactionId: { $in: transactions.map((t) => t._id) } })).lean();
  // Undone finishes count back
  const corrections = await InventoryTransaction.find(scoped(ctx, { correctsId: { $in: transactions.map((t) => t._id) } })).select('correctsId').lean();
  const undone = new Set(corrections.map((c) => String(c.correctsId)));
  const groups = {};
  for (const l of lines) {
    if (undone.has(String(l.transactionId))) continue;
    const who = heldByOf[String(l.transactionId)];
    const k = `${who?.kind}:${who?.name}:${l.skuId}`;
    const g = (groups[k] ??= { who, skuId: l.skuId, qty: 0, value: 0 });
    g.qty += -l.qty;
    g.value += -l.qty * (l.unitCost ?? 0);
  }
  const skuOf = await skuMap(ctx, Object.values(groups).map((g) => g.skuId));
  const KIND = { STAFF: 'Team member', STATION: 'Station', FLOOR: 'Salon floor' };
  return {
    title: 'Station and stylist use',
    note: 'Bottles marked finished, by who had them.',
    columns: [{ key: 'who', label: 'Who had it' }, { key: 'kind', label: 'Type' }, PRODUCT, UNIT, { key: 'qty', label: 'Finished', qty: true }, { key: 'value', label: 'Value (₹)', cost: true, money: true }],
    rows: Object.values(groups)
      .map((g) => ({ ...productCells(skuOf[String(g.skuId)]), who: g.who?.name ?? '—', kind: KIND[g.who?.kind] ?? '—', qty: g.qty, value: paise(g.value) }))
      .sort((a, b) => a.who.localeCompare(b.who) || a.product.localeCompare(b.product)),
  };
}

// What completed services used through their recipes (with corrections)
async function serviceUse(ctx, { branchIds, range }) {
  const events = await InventoryConsumptionEvent.find(scoped(ctx, { branchId: { $in: branchIds }, completedAt: range })).lean();
  const lines = await InventoryLedgerEntry.find(scoped(ctx, { transactionId: { $in: events.map((e) => e.transactionId) } })).select('transactionId qty unitCost').lean();
  const valueOf = {};
  for (const l of lines) valueOf[String(l.transactionId)] = (valueOf[String(l.transactionId)] ?? 0) - l.qty * (l.unitCost ?? 0);
  const groups = {};
  for (const e of events) {
    const g = (groups[`${e.serviceName}:${e.skuId}`] ??= { service: e.serviceName, skuId: e.skuId, services: new Set(), qty: 0, value: 0 });
    if (!e.correctsId) g.services.add(String(e.serviceLineId));
    g.qty += e.qty;
    g.value += valueOf[String(e.transactionId)] ?? 0;
  }
  const skuOf = await skuMap(ctx, Object.values(groups).map((g) => g.skuId));
  return {
    title: 'Service-linked use',
    columns: [{ key: 'service', label: 'Service' }, PRODUCT, UNIT, { key: 'services', label: 'Services done' }, { key: 'qty', label: 'Used', qty: true }, { key: 'perService', label: 'Average per service' }, { key: 'value', label: 'Value (₹)', cost: true, money: true }],
    rows: Object.values(groups)
      .map((g) => ({ ...productCells(skuOf[String(g.skuId)]), service: g.service, services: g.services.size, qty: g.qty, perService: g.services.size ? Math.round((g.qty / g.services.size) * 10) / 10 : null, value: paise(g.value) }))
      .sort((a, b) => a.service.localeCompare(b.service)),
  };
}

// Damage, loss, expiry, spillage and count corrections (kept apart from normal use)
async function waste(ctx, { branchIds, range }) {
  const lines = await InventoryLedgerEntry.find(scoped(ctx, { branchId: { $in: branchIds }, bucket: { $in: ['WASTED', 'ADJUSTED'] }, occurredAt: range })).lean();
  const transactions = await InventoryTransaction.find(scoped(ctx, { _id: { $in: lines.map((l) => l.transactionId) } })).select('reason type').lean();
  const reasonOf = Object.fromEntries(transactions.map((t) => [String(t._id), t.reason ?? (t.type === 'COUNT_CORRECTION' ? 'STOCK_COUNT_CORRECTION' : t.type)]));
  const groups = {};
  for (const l of lines) {
    const reason = reasonOf[String(l.transactionId)];
    const g = (groups[`${l.skuId}:${reason}`] ??= { skuId: l.skuId, reason, lost: 0, found: 0, value: 0 });
    if (l.qty < 0) g.lost += -l.qty;
    else g.found += l.qty;
    g.value += -l.qty * (l.unitCost ?? 0);
  }
  const skuOf = await skuMap(ctx, Object.values(groups).map((g) => g.skuId));
  return {
    title: 'Waste and shrinkage',
    note: 'Value is what was lost, less anything found in a count.',
    columns: [PRODUCT, { key: 'reason', label: 'Why' }, UNIT, { key: 'lost', label: 'Less', qty: true }, { key: 'found', label: 'Found', qty: true }, { key: 'value', label: 'Value lost (₹)', cost: true, money: true }],
    rows: Object.values(groups)
      .map((g) => ({ ...productCells(skuOf[String(g.skuId)]), reason: REASON_WORDS[g.reason] ?? g.reason, lost: g.lost, found: g.found, value: paise(g.value) }))
      .sort((a, b) => b.value - a.value),
  };
}

// Spend, deliveries, part deliveries and how long deliveries took, by supplier
async function purchasing(ctx, { branchIds, range }) {
  const [receipts, orders] = await Promise.all([
    InventoryGoodsReceipt.find(scoped(ctx, { branchId: { $in: branchIds }, kind: 'RECEIPT', at: range })).lean(),
    InventoryPurchaseOrder.find(scoped(ctx, { branchId: { $in: branchIds }, createdAt: range })).lean(),
  ]);
  const skuOf = await skuMap(ctx, receipts.flatMap((r) => r.lines.map((l) => l.skuId)));
  const firstReceiptOf = {};
  const allReceiptsForOrders = await InventoryGoodsReceipt.find(scoped(ctx, { poId: { $in: orders.map((o) => o._id) } })).select('poId at').sort({ at: 1 }).lean();
  for (const r of allReceiptsForOrders) firstReceiptOf[String(r.poId)] ??= r.at;

  const groups = {};
  const group = (name) => (groups[name] ??= { supplier: name, orders: 0, partly: 0, deliveries: 0, spend: 0, unpriced: 0, days: [] });
  for (const o of orders) {
    const g = group(o.supplierName);
    if (o.status === 'CANCELED') continue;
    g.orders += 1;
    if (o.status === 'PARTIALLY_RECEIVED' || (o.status === 'CLOSED' && o.lines.some((l) => l.receivedQty < l.qty))) g.partly += 1;
    const sentAt = o.orderedAt ?? o.approvedAt;
    if (sentAt && firstReceiptOf[String(o._id)]) g.days.push((firstReceiptOf[String(o._id)] - sentAt) / 86_400_000);
  }
  for (const r of receipts) {
    const g = group(r.supplierName ?? 'No supplier');
    g.deliveries += 1;
    for (const l of r.lines) {
      if (l.unitCost == null) g.unpriced += 1;
      else g.spend += (l.qty / skuOf[String(l.skuId)].unitsPerStockUnit) * l.unitCost;
    }
  }
  return {
    title: 'Purchasing',
    columns: [{ key: 'supplier', label: 'Supplier' }, { key: 'orders', label: 'Orders' }, { key: 'partly', label: 'Part delivered' }, { key: 'deliveries', label: 'Deliveries' }, { key: 'avgDays', label: 'Average days to arrive' }, { key: 'spend', label: 'Spend (₹)', cost: true, money: true }, { key: 'unpriced', label: 'Lines without a price', cost: true }],
    rows: Object.values(groups)
      .map((g) => ({ ...g, days: undefined, avgDays: g.days.length ? Math.round((g.days.reduce((a, b) => a + b, 0) / g.days.length) * 10) / 10 : null, spend: paise(g.spend) }))
      .sort((a, b) => b.spend - a.spend),
  };
}

// Price changes between deliveries, per product and supplier (costs only)
async function priceChanges(ctx, { branchIds, range }) {
  const receipts = await InventoryGoodsReceipt.find(scoped(ctx, { branchId: { $in: branchIds }, kind: 'RECEIPT', at: range })).sort({ at: 1 }).lean();
  const series = {};
  for (const r of receipts) {
    for (const l of r.lines) {
      if (l.unitCost == null) continue;
      (series[`${l.skuId}:${r.supplierName ?? ''}`] ??= { skuId: l.skuId, supplier: r.supplierName ?? '—', prices: [] }).prices.push({ cost: l.unitCost, at: r.at });
    }
  }
  const changed = Object.values(series).filter((s) => new Set(s.prices.map((p) => p.cost)).size > 1);
  const skuOf = await skuMap(ctx, changed.map((s) => s.skuId));
  return {
    title: 'Price changes',
    columns: [PRODUCT, { key: 'supplier', label: 'Supplier' }, { key: 'first', label: 'First price (₹)', cost: true, money: true }, { key: 'last', label: 'Latest price (₹)', cost: true, money: true }, { key: 'change', label: 'Change (%)', cost: true }, { key: 'deliveries', label: 'Deliveries' }],
    rows: changed.map((s) => {
      const first = s.prices[0].cost;
      const last = s.prices.at(-1).cost;
      return { ...productCells(skuOf[String(s.skuId)]), supplier: s.supplier, first, last, change: Math.round(((last - first) / first) * 1000) / 10, deliveries: s.prices.length };
    }),
  };
}

// Average cost and total value (costs only). Stock in use still counts: issuing isn't spending.
async function stockValue(ctx, args) {
  const summary = await stockSummary(ctx, args);
  const rows = await InventorySkuBranch.find(scoped(ctx, { branchId: { $in: args.branchIds }, active: true })).lean();
  const avgOf = Object.fromEntries(rows.map((r) => [`${args.branchName(r.branchId)}:${r.skuId}`, r.avgCost]));
  return {
    title: 'Stock value',
    note: 'Moving average cost. Stock handed out still counts as stock.',
    columns: [PRODUCT, BRANCH, UNIT, { key: 'onHand', label: 'On hand', qty: true }, { key: 'avgCost', label: 'Average cost per stock unit (₹)', cost: true, money: true }, { key: 'value', label: 'Value (₹)', cost: true, money: true }],
    rows: summary.rows.map((r) => {
      const avg = avgOf[`${r.branch}:${r._sku._id}`];
      return { ...r, avgCost: avg == null ? null : paise(avg * r._sku.unitsPerStockUnit) };
    }),
  };
}

// Services per finished bottle, for finish-mode products linked to services in a recipe. Approximate:
// a bottle belongs to whoever held it, not to exact services.
async function bottleEfficiency(ctx, { branchIds, range }) {
  const recipes = await InventoryRecipe.find(scoped(ctx, { branchId: { $in: [null, ...branchIds] }, 'lines.deducts': false })).lean();
  const linkedServices = {};
  for (const r of recipes) for (const l of r.lines) if (!l.deducts) (linkedServices[String(l.skuId)] ??= new Set()).add(String(r.serviceId));
  const skuOf = await skuMap(ctx, Object.keys(linkedServices));
  const finishSkus = Object.keys(linkedServices).filter((id) => skuOf[id]?.wayOfUse === 'FINISH');

  const finished = await InventoryLedgerEntry.aggregate([
    { $match: { orgId: oid(ctx.orgId), branchId: { $in: branchIds.map(oid) }, skuId: { $in: finishSkus.map(oid) }, bucket: 'CONSUMED', occurredAt: range } },
    { $group: { _id: '$skuId', qty: { $sum: { $multiply: ['$qty', -1] } } } },
  ]);
  const allServiceIds = [...new Set(finishSkus.flatMap((id) => [...linkedServices[id]]))].map(oid);
  const done = await Appointment.aggregate([
    { $match: { orgId: oid(ctx.orgId), branchId: { $in: branchIds.map(oid) }, status: 'COMPLETED', startAt: range } },
    { $unwind: '$items' },
    { $match: { 'items.serviceId': { $in: allServiceIds } } },
    { $group: { _id: '$items.serviceId', count: { $sum: 1 } } },
  ]);
  const countOf = Object.fromEntries(done.map((d) => [String(d._id), d.count]));

  return {
    title: 'Bottle efficiency (approximate)',
    note: 'Approximate: services done with each linked product, divided by bottles finished. A bottle belongs to whoever held it, not to exact services.',
    columns: [PRODUCT, { key: 'bottles', label: 'Bottles finished' }, { key: 'services', label: 'Linked services done' }, { key: 'perBottle', label: 'Services per bottle (approx.)' }],
    rows: finishSkus.map((id) => {
      const qty = finished.find((f) => String(f._id) === id)?.qty ?? 0;
      const services = [...linkedServices[id]].reduce((sum, s) => sum + (countOf[s] ?? 0), 0);
      const bottles = qty / skuOf[id].unitsPerStockUnit;
      return { ...productCells(skuOf[id]), bottles, services, perBottle: bottles > 0 ? Math.round((services / bottles) * 10) / 10 : null };
    }),
  };
}

export const REPORTS = {
  'stock-summary': { build: stockSummary },
  'low-stock': { build: lowStock },
  'use-by-product': { build: useByProduct },
  'recipient-use': { build: recipientUse },
  'service-use': { build: serviceUse },
  waste: { build: waste },
  purchasing: { build: purchasing },
  'price-changes': { build: priceChanges, costsOnly: true },
  'stock-value': { build: stockValue, costsOnly: true },
  'bottle-efficiency': { build: bottleEfficiency },
};

// Runs a report for the selected branch (or all the person's branches) between two dates (branch time)
export async function runReport(ctx, name, { from, to, branches }) {
  const report = REPORTS[name];
  if (!report) throw new AppError(404, 'NOT_FOUND', 'Report not found');
  const settings = await getBranchSettings(ctx, ctx.activeBranchId);
  assertCan(ctx, 'inventory.viewReports', { settings });
  const canSeeCosts = can(ctx, 'inventory.viewCosts', { settings }).allowed;
  if (report.costsOnly && !canSeeCosts) throw new AppError(403, 'PERMISSION_DENIED', 'This report is about costs, which only owners see');

  const branchIds = branches === 'all' ? ctx.allowedBranchIds : [ctx.activeBranchId];
  const branchDocs = await Branch.find(scoped(ctx, { _id: { $in: branchIds } })).select('name timezone').lean();
  const zone = branchDocs.find((b) => String(b._id) === String(ctx.activeBranchId))?.timezone ?? branchDocs[0].timezone;
  const today = todayInZone(zone);
  const toDate = to ?? today;
  const fromDate = from ?? DateTime.fromISO(toDate).minus({ days: 29 }).toISODate();
  if (fromDate > toDate) throw new AppError(400, 'VALIDATION_ERROR', 'The start date is after the end date');
  const range = { $gte: dayRangeUTC(fromDate, zone).start, $lt: dayRangeUTC(toDate, zone).end };
  const nameOf = Object.fromEntries(branchDocs.map((b) => [String(b._id), b.name]));

  const result = await report.build(ctx, { branchIds, range, branchName: (id) => nameOf[String(id)] });
  const columns = result.columns.filter((c) => canSeeCosts || !c.cost);
  const hidden = result.columns.filter((c) => !columns.includes(c)).map((c) => c.key);
  const rows = result.rows.map((row) => {
    const copy = { ...row };
    for (const key of hidden) delete copy[key];
    return copy;
  });
  return { name, title: result.title, note: result.note, from: fromDate, to: toDate, branches: branchDocs.map((b) => b.name), columns, rows };
}

// The same report as CSV: quantities as plain numbers (with the unit column), money in rupees
export { toCsv } from '../../../utils/csv.js';
