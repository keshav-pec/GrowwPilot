import { InventorySupplier } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { escapeRegex } from '../../../utils/regex.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';

// Suppliers (INV-10), for the whole salon. Prices live on purchase orders, so nothing here is a cost.

async function allow(ctx) {
  assertCan(ctx, 'inventory.manageSuppliers', { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
}

export async function listSuppliers(ctx, { includeInactive } = {}) {
  const filter = scoped(ctx);
  if (!includeInactive) filter.active = true;
  return InventorySupplier.find(filter).sort({ name: 1 }).lean();
}

export async function findSupplier(ctx, id, session = null) {
  const supplier = await InventorySupplier.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!supplier) throw new AppError(404, 'NOT_FOUND', 'Supplier not found');
  return supplier;
}

async function assertNameFree(ctx, name, exceptId) {
  const filter = scoped(ctx, { name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
  if (exceptId) filter._id = { $ne: exceptId };
  if (await InventorySupplier.exists(filter)) throw new AppError(409, 'NAME_TAKEN', `There is already a supplier called “${name}”`);
}

export async function createSupplier(ctx, input, key) {
  await allow(ctx);
  await assertNameFree(ctx, input.name);
  return runOnce(ctx, { key, operation: 'inventory.supplier.create' }, async (session) => {
    const [supplier] = await InventorySupplier.create([{ ...input, orgId: ctx.orgId }], { session });
    await recordInventoryAction(ctx, { action: 'inventory.supplier_added', branchId: ctx.activeBranchId, summary: `Added the supplier ${supplier.name}`, link: '/app/inventory?tab=purchasing' }, session);
    return { supplier };
  });
}

export async function updateSupplier(ctx, id, input, key) {
  await allow(ctx);
  const supplier = await findSupplier(ctx, id);
  if (input.name) await assertNameFree(ctx, input.name, supplier._id);
  return runOnce(ctx, { key, operation: 'inventory.supplier.update' }, async (session) => {
    const updated = await InventorySupplier.findOneAndUpdate(scoped(ctx, { _id: supplier._id }), { $set: input }, { returnDocument: 'after', session, runValidators: true }).lean();
    await recordInventoryAction(
      ctx,
      { action: 'inventory.supplier_changed', branchId: ctx.activeBranchId, summary: `Changed the supplier ${updated.name}`, before: supplier, after: input, link: '/app/inventory?tab=purchasing' },
      session
    );
    return { supplier: updated };
  });
}
