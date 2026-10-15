import { InventoryImport, InventorySku, InventorySkuBranch } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan, can } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { postOpeningStock } from '../stock/stock.engine.js';
import { ensureBranchLocations } from '../locations/locations.service.js';
import { reserveSkuCodes } from '../skus/skuCodes.js';
import { checkImportRow, rowStatus } from './imports.rules.js';

// Who may import (anyone who may add products: owners and inventory logins), and whether costs are accepted
async function importAccess(ctx) {
  const settings = await getBranchSettings(ctx, ctx.activeBranchId);
  assertCan(ctx, 'inventory.editProducts', { settings });
  return { canSeeCosts: can(ctx, 'inventory.viewCosts', { settings }).allowed };
}

const nameKey = (name) => name.trim().toLowerCase();

// Checks every row on its own, then for duplicates: against the salon's products and within the file.
// Same code or barcode = must fix (they have to be unique). Same name = warning (it may be on purpose).
// rows: [{ row, raw }]
async function checkRows(ctx, rows, { canSeeCosts }, session) {
  const existing = await InventorySku.find(scoped(ctx)).select('name code barcodes').session(session ?? null).lean();
  const codeOwner = new Map(existing.map((s) => [s.code, s.name]));
  const barcodeOwner = new Map(existing.flatMap((s) => s.barcodes.map((b) => [b, s.name])));
  const nameTaken = new Set(existing.map((s) => nameKey(s.name)));
  const firstRowWith = { code: new Map(), barcode: new Map(), name: new Map() };

  return rows.map(({ row, raw }) => {
    const { values, problems } = checkImportRow(raw, { canSeeCosts });
    const error = (field, message) => problems.push({ field, level: 'error', message });
    const warning = (field, message) => problems.push({ field, level: 'warning', message });

    if (values.code) {
      if (codeOwner.has(values.code)) error('sku_code', `The code ${values.code} is already used by ${codeOwner.get(values.code)}`);
      else if (firstRowWith.code.has(values.code)) error('sku_code', `Same code as row ${firstRowWith.code.get(values.code)}`);
      else firstRowWith.code.set(values.code, row);
    }
    for (const barcode of values.barcodes) {
      if (barcodeOwner.has(barcode)) error('barcode', `The barcode ${barcode} is already used by ${barcodeOwner.get(barcode)}`);
      else if (firstRowWith.barcode.has(barcode)) error('barcode', `Same barcode as row ${firstRowWith.barcode.get(barcode)}`);
      else firstRowWith.barcode.set(barcode, row);
    }
    if (values.name) {
      const key = nameKey(values.name);
      if (nameTaken.has(key)) warning('name', 'A product with this name already exists. Importing adds a second one.');
      else if (firstRowWith.name.has(key)) warning('name', `Same name as row ${firstRowWith.name.get(key)}`);
      else firstRowWith.name.set(key, row);
    }

    return { row, raw, values, status: rowStatus(problems), problems };
  });
}

const countByStatus = (rows) => ({
  ready: rows.filter((r) => r.status === 'ready').length,
  warning: rows.filter((r) => r.status === 'warning').length,
  error: rows.filter((r) => r.status === 'error').length,
});

const toPreview = (batch) => ({ _id: batch._id, fileName: batch.fileName, status: batch.status, rows: batch.rows, counts: countByStatus(batch.rows) });

// Step 1: check the file and save it as a preview. Nothing becomes a product yet.
// rows: the file's rows in order, as text ({ name, category, ... }). Row numbers count the header as line 1.
export async function previewImport(ctx, { fileName, rows }) {
  const access = await importAccess(ctx);
  const checked = await checkRows(ctx, rows.map((raw, i) => ({ row: i + 2, raw })), access);
  const batch = await InventoryImport.create({ orgId: ctx.orgId, branchId: ctx.activeBranchId, createdBy: ctx.userId, fileName, rows: checked });
  return { import: toPreview(batch.toObject()) };
}

export async function getImport(ctx, id) {
  await importAccess(ctx);
  const batch = await InventoryImport.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId })).lean();
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Import not found. Imports are kept for 24 hours; please upload the file again.');
  return { import: toPreview(batch) };
}

// Step 2: save every row that has nothing to fix, except the ones left out.
// One transaction: either all of them are added (each with its own opening-stock movement) or none.
export async function commitImport(ctx, id, { skipRows }, key) {
  const branchId = ctx.activeBranchId;
  const access = await importAccess(ctx);
  const batch = await InventoryImport.findOne(scoped(ctx, { _id: id, branchId })).lean();
  if (!batch) throw new AppError(404, 'NOT_FOUND', 'Import not found. Imports are kept for 24 hours; please upload the file again.');
  const { mainStore } = await ensureBranchLocations(ctx, branchId);

  const skip = new Set(skipRows);
  const chosen = batch.rows.filter((r) => r.status !== 'error' && !skip.has(r.row));
  if (chosen.length === 0) throw new AppError(400, 'NOTHING_TO_IMPORT', 'There are no rows to import');

  return runOnce(ctx, { key, operation: 'inventory.import.commit' }, async (session) => {
    // A file is imported only once (checked inside the transaction, so two clicks can't both pass)
    const marked = await InventoryImport.updateOne(scoped(ctx, { _id: batch._id, status: 'preview' }), { $set: { status: 'committed', committedAt: new Date() } }, { session });
    if (marked.modifiedCount === 0) throw new AppError(409, 'ALREADY_IMPORTED', 'This file has already been imported');

    // Check again: someone may have added a product with the same code or barcode since the preview
    const rechecked = await checkRows(ctx, chosen.map(({ row, raw }) => ({ row, raw })), access, session);
    const nowWrong = rechecked.filter((r) => r.status === 'error');
    if (nowWrong.length > 0) {
      throw new AppError(409, 'IMPORT_CHANGED', 'Some rows clash with products added since you checked the file. Please check it again.', {
        rows: nowWrong.map((r) => r.row),
      });
    }

    const codes = await reserveSkuCodes(ctx, rechecked.filter((r) => !r.values.code).length, session);
    const products = rechecked.map(({ values }) => {
      const { openingQty, openingUnitCost, reorderPoint, reorderQty, code, ...product } = values;
      return { ...product, orgId: ctx.orgId, code: code ?? codes.shift(), createdBy: ctx.userId };
    });
    const skus = await InventorySku.insertMany(products, { session });
    await InventorySkuBranch.insertMany(
      skus.map((sku, i) => ({ orgId: ctx.orgId, branchId, skuId: sku._id, reorderPoint: rechecked[i].values.reorderPoint, reorderQty: rechecked[i].values.reorderQty })),
      { session }
    );

    // One opening-stock movement per product that has a quantity. The cost is per stock unit (per bottle).
    const openings = skus
      .map((sku, i) => ({ sku, values: rechecked[i].values }))
      .filter(({ values }) => values.openingQty > 0)
      .map(({ sku, values }) => ({
        skuId: sku._id,
        qty: values.openingQty,
        unitCost: values.openingUnitCost == null ? null : values.openingUnitCost / sku.unitsPerStockUnit,
      }));
    await postOpeningStock(ctx, { branchId, locationId: mainStore._id, requestKey: key, items: openings }, session);

    const result = { created: skus.length, withStock: openings.length, skipped: batch.rows.length - skus.length };
    await InventoryImport.updateOne(scoped(ctx, { _id: batch._id }), { $set: { result } }, { session });
    const from = batch.fileName ? ` from ${batch.fileName}` : ' from a spreadsheet';
    await recordInventoryAction(
      ctx,
      { action: 'inventory.products_imported', branchId, summary: `Imported ${skus.length} product${skus.length === 1 ? '' : 's'}${from}`, after: result, link: '/app/inventory?tab=products' },
      session
    );
    return result;
  });
}
