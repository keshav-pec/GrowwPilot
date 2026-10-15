import {
  Counter,
  InventoryAllocation,
  InventoryBalance,
  InventoryLedgerEntry,
  InventorySku,
  InventorySkuBranch,
  InventoryTransaction,
} from '../../../models/index.js';
import { isMeasured } from '../../../config/inventory.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { escapeRegex } from '../../../utils/regex.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan, can } from '../permissions.js';
import { withoutCosts } from '../serializers.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { describeQty } from '../units.js';
import { postMovement } from '../stock/stock.engine.js';
import { availableToIssue, branchStock } from '../stock/stock.queries.js';
import { ensureBranchLocations, listLocations } from '../locations/locations.service.js';

const PAGE_SIZE = 50;
const HISTORY_PAGE_SIZE = 25;
const productLink = (id) => `/app/inventory?tab=products&product=${id}`;

// The fields that describe the product itself (the same at every branch)
const PRODUCT_FIELDS = ['name', 'category', 'brand', 'barcodes', 'type', 'stockUnit', 'wayOfUse', 'baseUnit', 'unitsPerStockUnit'];
const BRANCH_FIELDS = ['reorderPoint', 'reorderQty', 'leadTimeDays'];

// What I may do here, with the selected branch's settings
async function access(ctx) {
  const settings = await getBranchSettings(ctx, ctx.activeBranchId);
  return { settings, canSeeCosts: can(ctx, 'inventory.viewCosts', { settings }).allowed };
}

// A product of my salon (another salon's id is simply "not found")
async function findSku(ctx, id, session) {
  const sku = await InventorySku.findOne(scoped(ctx, { _id: id })).session(session ?? null).lean();
  if (!sku) throw new AppError(404, 'NOT_FOUND', 'Product not found');
  return sku;
}

// The business owner edits any product. Branch owners and inventory logins only edit products
// used nowhere but their own branches (reorder levels for their branch are always theirs to set).
async function canEditProduct(ctx, sku) {
  if (ctx.isPrimaryOwner) return true;
  const branchIds = await InventorySkuBranch.find(scoped(ctx, { skuId: sku._id, active: true })).distinct('branchId');
  return branchIds.every((id) => ctx.allowedBranchIds.includes(String(id)));
}

// Measured products are counted in ml / g / pieces, all others in their stock unit.
// Their counting can't change once there is stock history, or old numbers would mean something else.
function countingChanges(before, after) {
  if (isMeasured(before) !== isMeasured(after)) return true;
  return isMeasured(after) && (before.baseUnit !== after.baseUnit || before.unitsPerStockUnit !== after.unitsPerStockUnit);
}

// Products that aren't measured are counted in whole stock units
function normalizeUnits(product) {
  if (!isMeasured(product)) {
    product.baseUnit = null;
    product.unitsPerStockUnit = 1;
  }
  return product;
}

async function assertCodeAndBarcodesFree(ctx, { code, barcodes = [] }, exceptId, session) {
  const others = exceptId ? { _id: { $ne: exceptId } } : {};
  if (code) {
    const taken = await InventorySku.findOne(scoped(ctx, { code, ...others })).select('name').session(session).lean();
    if (taken) throw new AppError(409, 'CODE_TAKEN', `The code ${code} is already used by ${taken.name}`, { skuId: taken._id, name: taken.name });
  }
  if (barcodes.length > 0) {
    const taken = await InventorySku.findOne(scoped(ctx, { barcodes: { $in: barcodes }, ...others })).select('name barcodes').session(session).lean();
    if (taken) {
      const barcode = barcodes.find((b) => taken.barcodes.includes(b));
      throw new AppError(409, 'BARCODE_TAKEN', `The barcode ${barcode} is already used by ${taken.name}`, { skuId: taken._id, name: taken.name });
    }
  }
}

// SKU-000123: one counter per salon. Skips numbers someone already typed in as their own code.
async function nextSkuCode(ctx, session) {
  for (;;) {
    const counter = await Counter.findOneAndUpdate({ _id: `sku:${ctx.orgId}` }, { $inc: { seq: 1 } }, { upsert: true, returnDocument: 'after', session });
    const code = `SKU-${String(counter.seq).padStart(6, '0')}`;
    if (!(await InventorySku.exists(scoped(ctx, { code })).session(session))) return code;
  }
}

// ---------------------------------------------------------------------------
// Add a product at the selected branch, with its opening stock as a movement (never by setting a balance)
// ---------------------------------------------------------------------------
export async function createSku(ctx, input, key) {
  const branchId = ctx.activeBranchId;
  const { settings, canSeeCosts } = await access(ctx);
  assertCan(ctx, 'inventory.editProducts', { settings });
  if (input.openingUnitCost != null && !canSeeCosts) throw new AppError(403, 'PERMISSION_DENIED', 'Only owners can enter costs');

  const { mainStore } = await ensureBranchLocations(ctx, branchId);
  const { openingQty, openingUnitCost, reorderPoint = null, reorderQty = null, leadTimeDays = null, code, ...product } = input;
  normalizeUnits(product);

  return runOnce(ctx, { key, operation: 'inventory.sku.create' }, async (session) => {
    await assertCodeAndBarcodesFree(ctx, { code, barcodes: product.barcodes }, null, session);
    const [sku] = await InventorySku.create(
      [{ ...product, orgId: ctx.orgId, code: code ?? (await nextSkuCode(ctx, session)), createdBy: ctx.userId }],
      { session }
    );
    await InventorySkuBranch.create([{ orgId: ctx.orgId, branchId, skuId: sku._id, reorderPoint, reorderQty, leadTimeDays }], { session });

    let summary = `Added the product ${sku.name} (${sku.code})`;
    if (openingQty > 0) {
      // The cost is entered per stock unit (per bottle); measured products are counted per ml / g
      const unitCost = openingUnitCost == null ? null : openingUnitCost / sku.unitsPerStockUnit;
      await postMovement(
        ctx,
        { branchId, type: 'OPENING', requestKey: key, lines: [{ skuId: sku._id, locationId: mainStore._id, qty: openingQty, unitCost, bucket: 'OPENING' }] },
        session
      );
      summary += ` with ${describeQty(openingQty, sku)} opening stock`;
    }
    await recordInventoryAction(ctx, { action: 'inventory.product_added', branchId, summary, after: { code: sku.code, name: sku.name }, link: productLink(sku._id) }, session);
    return { sku };
  });
}

// ---------------------------------------------------------------------------
// Edit a product (and its reorder levels at the selected branch)
// ---------------------------------------------------------------------------
export async function updateSku(ctx, id, input, key) {
  const branchId = ctx.activeBranchId;
  const sku = await findSku(ctx, id);
  const { settings } = await access(ctx);
  assertCan(ctx, 'inventory.editProducts', { settings });

  const { version } = input;
  const productChanges = {};
  for (const field of PRODUCT_FIELDS) {
    if (input[field] !== undefined && JSON.stringify(input[field]) !== JSON.stringify(sku[field] ?? null)) productChanges[field] = input[field];
  }
  const branchChanges = Object.fromEntries(BRANCH_FIELDS.filter((f) => input[f] !== undefined).map((f) => [f, input[f]]));

  const next = normalizeUnits({ ...sku, ...productChanges });
  for (const field of ['baseUnit', 'unitsPerStockUnit']) {
    if (next[field] !== sku[field]) productChanges[field] = next[field];
    else delete productChanges[field];
  }

  if (Object.keys(productChanges).length > 0) {
    if (!(await canEditProduct(ctx, sku))) {
      throw new AppError(403, 'PERMISSION_DENIED', 'This product is also used at other branches. Ask the business owner to change it.');
    }
    if (productChanges.wayOfUse && (await InventoryAllocation.exists(scoped(ctx, { skuId: sku._id, status: 'OPEN' })))) {
      throw new AppError(409, 'MODE_CHANGE_BLOCKED', `${sku.name} has open hand-outs. Finish or return them before changing how it is used.`);
    }
    if (countingChanges(sku, next) && (await InventoryLedgerEntry.exists(scoped(ctx, { skuId: sku._id })))) {
      throw new AppError(409, 'COUNTING_CHANGE_BLOCKED', `${sku.name} already has stock history, so how it is counted can’t change. Add it as a new product instead.`);
    }
  }
  if (Object.keys(branchChanges).length > 0 && !(await InventorySkuBranch.exists(scoped(ctx, { branchId, skuId: sku._id })))) {
    throw new AppError(409, 'NOT_USED_HERE', `${sku.name} isn’t used at this branch yet`);
  }

  return runOnce(ctx, { key, operation: 'inventory.sku.update' }, async (session) => {
    if (productChanges.barcodes) await assertCodeAndBarcodesFree(ctx, { barcodes: productChanges.barcodes }, sku._id, session);

    // Only matches if nobody saved a newer version in the meantime
    const updated = await InventorySku.findOneAndUpdate(
      scoped(ctx, { _id: sku._id, version }),
      { $set: productChanges, $inc: { version: 1 } },
      { returnDocument: 'after', runValidators: true, session }
    ).lean();
    if (!updated) throw new AppError(409, 'STALE_VERSION', 'Someone else changed this product. Close it and open it again to see the latest.');

    if (Object.keys(branchChanges).length > 0) {
      await InventorySkuBranch.updateOne(scoped(ctx, { branchId, skuId: sku._id }), { $set: branchChanges }, { session, runValidators: true });
    }

    const changed = [...Object.keys(productChanges), ...Object.keys(branchChanges)];
    if (changed.length > 0) {
      const before = Object.fromEntries(Object.keys(productChanges).map((f) => [f, sku[f]]));
      await recordInventoryAction(
        ctx,
        { action: 'inventory.product_changed', branchId, summary: `Changed ${updated.name} (${updated.code})`, before, after: { ...productChanges, ...branchChanges }, link: productLink(sku._id) },
        session
      );
    }
    return { sku: updated };
  });
}

// Deactivate or reactivate. A deactivated product keeps all its stock history.
export async function setSkuStatus(ctx, id, { status, version }, key) {
  const sku = await findSku(ctx, id);
  const { settings } = await access(ctx);
  assertCan(ctx, 'inventory.editProducts', { settings });
  if (!(await canEditProduct(ctx, sku))) {
    throw new AppError(403, 'PERMISSION_DENIED', 'This product is also used at other branches. Ask the business owner to change it.');
  }

  return runOnce(ctx, { key, operation: 'inventory.sku.status' }, async (session) => {
    const updated = await InventorySku.findOneAndUpdate(scoped(ctx, { _id: sku._id, version }), { $set: { status }, $inc: { version: 1 } }, { returnDocument: 'after', session }).lean();
    if (!updated) throw new AppError(409, 'STALE_VERSION', 'Someone else changed this product. Close it and open it again to see the latest.');
    if (status !== sku.status) {
      const verb = status === 'inactive' ? 'Deactivated' : 'Reactivated';
      await recordInventoryAction(ctx, { action: 'inventory.product_status', branchId: ctx.activeBranchId, summary: `${verb} ${sku.name} (${sku.code})`, before: { status: sku.status }, after: { status }, link: productLink(sku._id) }, session);
    }
    return { sku: updated };
  });
}

// Start using one of the salon's products at the selected branch (e.g. a product the other branch already has)
export async function useSkuHere(ctx, id, key) {
  const branchId = ctx.activeBranchId;
  const sku = await findSku(ctx, id);
  const { settings } = await access(ctx);
  assertCan(ctx, 'inventory.editProducts', { settings });
  await ensureBranchLocations(ctx, branchId);

  return runOnce(ctx, { key, operation: 'inventory.sku.useHere' }, async (session) => {
    const existing = await InventorySkuBranch.findOne(scoped(ctx, { branchId, skuId: sku._id })).session(session);
    if (existing?.active) return { sku };
    if (existing) {
      existing.active = true;
      await existing.save({ session });
    } else {
      await InventorySkuBranch.create([{ orgId: ctx.orgId, branchId, skuId: sku._id }], { session });
    }
    await recordInventoryAction(ctx, { action: 'inventory.product_added', branchId, summary: `Started using ${sku.name} (${sku.code}) at this branch`, link: productLink(sku._id) }, session);
    return { sku };
  });
}

// ---------------------------------------------------------------------------
// Products screen: search by name, code or barcode (a barcode scanner types into the search box)
// ---------------------------------------------------------------------------
export async function listSkus(ctx, { search, category, wayOfUse, status, needToOrder, scope, page }) {
  const branchId = ctx.activeBranchId;
  const { canSeeCosts } = await access(ctx);

  const branchRows = await InventorySkuBranch.find(scoped(ctx, { branchId, active: true })).lean();
  const usedHere = branchRows.map((r) => r.skuId);
  const filter = scoped(ctx, { _id: scope === 'branch' ? { $in: usedHere } : { $nin: usedHere } });
  if (status !== 'all') filter.status = status;
  if (category) filter.category = category;
  if (wayOfUse) filter.wayOfUse = wayOfUse;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i');
    filter.$or = [{ name: pattern }, { brand: pattern }, { code: new RegExp(`^${escapeRegex(search)}`, 'i') }, { barcodes: search }];
  }

  const [skus, categories] = await Promise.all([
    InventorySku.find(filter).sort({ name: 1 }).lean(),
    InventorySku.distinct('category', scoped(ctx)),
  ]);
  const stock = scope === 'branch' ? await branchStock(ctx, branchId, skus.map((s) => s._id)) : {};
  const branchRowOf = Object.fromEntries(branchRows.map((r) => [String(r.skuId), r]));

  let rows = skus.map((sku) => {
    const here = branchRowOf[String(sku._id)];
    const { inStore = 0, inUse = 0 } = stock[String(sku._id)] ?? {};
    const available = availableToIssue({ inStore });
    return withoutCosts(
      {
        ...sku,
        inStore,
        inUse,
        available,
        reorderPoint: here?.reorderPoint ?? null,
        reorderQty: here?.reorderQty ?? null,
        needToOrder: here?.reorderPoint != null && available <= here.reorderPoint,
        avgCost: here?.avgCost ?? null,
        value: here?.avgCost != null ? Math.round((inStore + inUse) * here.avgCost) : null,
      },
      canSeeCosts
    );
  });
  if (needToOrder) rows = rows.filter((r) => r.needToOrder);

  // A scanned barcode or a typed code that matches one product exactly: the screen can open it straight away
  const exact = search ? rows.filter((r) => r.barcodes.includes(search) || r.code === search.toUpperCase()) : [];

  return {
    rows: rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page,
    pages: Math.max(Math.ceil(rows.length / PAGE_SIZE), 1),
    total: rows.length,
    categories: categories.sort(),
    exactMatchId: exact.length === 1 ? exact[0]._id : null,
  };
}

// ---------------------------------------------------------------------------
// Product page: stock per place at the selected branch, open hand-outs, and what I may do with it
// ---------------------------------------------------------------------------
export async function getSku(ctx, id) {
  const branchId = ctx.activeBranchId;
  const sku = await findSku(ctx, id);
  const { settings, canSeeCosts } = await access(ctx);

  const [here, locations, handouts] = await Promise.all([
    InventorySkuBranch.findOne(scoped(ctx, { branchId, skuId: sku._id })).lean(),
    listLocations(ctx),
    InventoryAllocation.find(scoped(ctx, { branchId, skuId: sku._id, status: 'OPEN' })).sort({ createdAt: 1 }).lean(),
  ]);
  const balances = await balanceRows(ctx, branchId, sku._id, locations);
  const inStore = balances.filter((b) => b.kind === 'STORE').reduce((sum, b) => sum + b.qty, 0);
  const inUse = balances.filter((b) => b.kind === 'IN_USE').reduce((sum, b) => sum + b.qty, 0);
  const available = availableToIssue({ inStore });
  const mayEditProducts = can(ctx, 'inventory.editProducts', { settings }).allowed;

  return {
    sku,
    usedHere: Boolean(here?.active),
    branch: withoutCosts(
      {
        reorderPoint: here?.reorderPoint ?? null,
        reorderQty: here?.reorderQty ?? null,
        leadTimeDays: here?.leadTimeDays ?? null,
        avgCost: here?.avgCost ?? null,
        value: here?.avgCost != null ? Math.round((inStore + inUse) * here.avgCost) : null,
      },
      canSeeCosts
    ),
    totals: { inStore, inUse, available, needToOrder: here?.reorderPoint != null && available <= here.reorderPoint },
    balances,
    handouts,
    canEdit: mayEditProducts && (await canEditProduct(ctx, sku)),
    canSetReorder: mayEditProducts,
  };
}

// One row per store and In use (stations hold nothing themselves), with zeros where there is nothing.
// Closed stores only show up while they still have stock.
async function balanceRows(ctx, branchId, skuId, locations) {
  const balances = await InventoryBalance.find(scoped(ctx, { branchId, skuId })).select('locationId qty').lean();
  const qtyAt = Object.fromEntries(balances.map((b) => [String(b.locationId), b.qty]));
  return locations
    .filter((l) => l.kind !== 'STATION' && (l.active || qtyAt[String(l._id)]))
    .map((l) => ({ locationId: l._id, name: l.name, kind: l.kind, isMain: l.isMain, qty: qtyAt[String(l._id)] ?? 0 }));
}

// ---------------------------------------------------------------------------
// Movement history (INV-13): every change to this product's stock at the selected branch, newest first
// ---------------------------------------------------------------------------
export async function listSkuMovements(ctx, id, { page }) {
  const branchId = ctx.activeBranchId;
  const sku = await findSku(ctx, id);
  const { canSeeCosts } = await access(ctx);

  const filter = scoped(ctx, { branchId, skuId: sku._id });
  const [entries, total] = await Promise.all([
    InventoryLedgerEntry.find(filter)
      .sort({ postedAt: -1, _id: -1 })
      .skip((page - 1) * HISTORY_PAGE_SIZE)
      .limit(HISTORY_PAGE_SIZE)
      .populate('locationId', 'name kind')
      .lean(),
    InventoryLedgerEntry.countDocuments(filter),
  ]);
  const transactions = await InventoryTransaction.find(scoped(ctx, { _id: { $in: entries.map((e) => e.transactionId) } })).lean();
  const transactionOf = Object.fromEntries(transactions.map((t) => [String(t._id), t]));

  const items = entries.map((e) => {
    const t = transactionOf[String(e.transactionId)];
    return withoutCosts(
      {
        _id: e._id,
        transactionId: e.transactionId,
        type: t.type,
        reason: t.reason,
        note: t.note,
        location: e.locationId, // { name, kind }
        qty: e.qty,
        bucket: e.bucket,
        unitCost: e.unitCost,
        actorName: t.actorName,
        actorRole: t.actorRole,
        heldBy: t.heldBy?.kind ? t.heldBy : null,
        correctsId: t.correctsId,
        occurredAt: e.occurredAt,
        postedAt: e.postedAt,
      },
      canSeeCosts
    );
  });
  return { items, page, pages: Math.max(Math.ceil(total / HISTORY_PAGE_SIZE), 1), total };
}
