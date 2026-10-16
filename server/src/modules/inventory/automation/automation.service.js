import { InventoryConsumptionEvent, InventoryException, InventoryOutbox, InventorySku, Appointment } from '../../../models/index.js';
import { isMeasured } from '../../../config/inventory.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { actorRole } from '../../activity/activity.service.js';
import { assertCan } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';
import { ensureBranchLocations } from '../locations/locations.service.js';
import { describeQty } from '../units.js';
import { giveBackServiceUse, pickUse, postServiceUse } from './serviceUse.js';
import { processSoon } from './outbox.js';

// Exceptions list, failed events and corrections for automatic use by services.

const SKU_FIELDS = 'name code stockUnit wayOfUse baseUnit unitsPerStockUnit';
const me = (ctx) => ({ id: ctx.userId, name: ctx.userName, role: actorRole(ctx) });

async function allow(ctx, action) {
  assertCan(ctx, action, { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
}

// What is waiting at the selected branch: uses that couldn't be posted, and events that failed
export async function listAutomation(ctx) {
  await allow(ctx, 'inventory.resolveExceptions');
  const branchId = ctx.activeBranchId;
  const [exceptions, failedEvents] = await Promise.all([
    InventoryException.find(scoped(ctx, { branchId, status: 'OPEN' })).sort({ completedAt: 1 }).lean(),
    InventoryOutbox.find(scoped(ctx, { branchId, status: 'FAILED' })).sort({ createdAt: 1 }).lean(),
  ]);
  const [skus, appointments] = await Promise.all([
    InventorySku.find(scoped(ctx, { _id: { $in: exceptions.map((e) => e.skuId) } })).select(SKU_FIELDS).lean(),
    Appointment.find(scoped(ctx, { _id: { $in: [...exceptions, ...failedEvents].map((e) => e.appointmentId) } })).select('customerSnapshot.name').lean(),
  ]);
  const skuOf = Object.fromEntries(skus.map((s) => [String(s._id), s]));
  const customerOf = Object.fromEntries(appointments.map((a) => [String(a._id), a.customerSnapshot.name]));
  return {
    exceptions: exceptions.map((e) => ({ ...e, sku: skuOf[String(e.skuId)], customerName: customerOf[String(e.appointmentId)] })),
    failedEvents: failedEvents.map((e) => ({ ...e, customerName: customerOf[String(e.appointmentId)] })),
  };
}

// After restocking: post a use that couldn't be taken, with the amount the recipe said then
export async function postException(ctx, id, key) {
  await allow(ctx, 'inventory.resolveExceptions');
  const exception = await InventoryException.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId })).lean();
  if (!exception) throw new AppError(404, 'NOT_FOUND', 'Exception not found');
  if (exception.status !== 'OPEN') throw new AppError(409, 'ALREADY_DECIDED', 'This has already been dealt with');
  await ensureBranchLocations(ctx, exception.branchId);

  return runOnce(ctx, { key, operation: 'inventory.exception.post' }, async (session) => {
    const { transaction } = await postServiceUse(ctx, { ...pickUse(exception), key: exception.key }, { actor: me(ctx) }, session);
    const marked = await InventoryException.updateOne(
      scoped(ctx, { _id: exception._id, status: 'OPEN' }),
      { $set: { status: 'POSTED', resolvedBy: { id: ctx.userId, name: ctx.userName }, resolvedAt: new Date(), transactionId: transaction._id } },
      { session }
    );
    if (marked.modifiedCount === 0) throw new AppError(409, 'ALREADY_DECIDED', 'This has already been dealt with');
    return { status: 'POSTED', transactionId: transaction._id };
  });
}

// An owner decides it should not be taken at all (e.g. the recipe was wrong for that visit)
export async function dismissException(ctx, id, { note }, key) {
  await allow(ctx, 'inventory.dismissExceptions');
  const exception = await InventoryException.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId })).lean();
  if (!exception) throw new AppError(404, 'NOT_FOUND', 'Exception not found');

  return runOnce(ctx, { key, operation: 'inventory.exception.dismiss' }, async (session) => {
    const marked = await InventoryException.updateOne(
      scoped(ctx, { _id: exception._id, status: 'OPEN' }),
      { $set: { status: 'DISMISSED', resolvedBy: { id: ctx.userId, name: ctx.userName }, resolvedAt: new Date(), note } },
      { session }
    );
    if (marked.modifiedCount === 0) throw new AppError(409, 'ALREADY_DECIDED', 'This has already been dealt with');
    await recordInventoryAction(
      ctx,
      { action: 'inventory.exception_dismissed', branchId: exception.branchId, summary: `Dismissed ${exception.skuName} for ${exception.serviceName} (${exception.staffName}): ${note}` },
      session
    );
    return { status: 'DISMISSED' };
  });
}

// Try a failed event again now (it can't use stock twice: every line has its own key)
export async function retryEvent(ctx, id) {
  await allow(ctx, 'inventory.resolveExceptions');
  const retried = await InventoryOutbox.updateOne(
    scoped(ctx, { _id: id, branchId: ctx.activeBranchId, status: 'FAILED' }),
    { $set: { status: 'PENDING', attempts: 0, nextAttemptAt: new Date(), lastError: null } }
  );
  if (retried.matchedCount === 0) throw new AppError(404, 'NOT_FOUND', 'Failed event not found');
  processSoon();
  return { status: 'PENDING' };
}

// "Used 110 ml, not 90": posts only the difference, linked to the original (measured products only)
export async function correctServiceUse(ctx, id, { actualQty, note }, key) {
  await allow(ctx, 'inventory.correctServiceUse');
  const original = await InventoryConsumptionEvent.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId, correctsId: null })).lean();
  if (!original) throw new AppError(404, 'NOT_FOUND', 'Service use not found');
  const sku = await InventorySku.findOne(scoped(ctx, { _id: original.skuId })).select(SKU_FIELDS).lean();
  if (!isMeasured(sku)) throw new AppError(400, 'VALIDATION_ERROR', 'Only products used by measure (ml, g) can have their amount corrected');

  const fixes = await InventoryConsumptionEvent.find(scoped(ctx, { correctsId: original._id })).sort({ createdAt: 1 }).lean();
  const current = original.qty + fixes.reduce((sum, f) => sum + f.qty, 0);
  const delta = actualQty - current;
  if (delta === 0) throw new AppError(400, 'VALIDATION_ERROR', `${describeQty(current, sku)} is already the amount recorded`);
  // Each movement can be corrected once, so corrections form a chain: this one points at the latest
  const correctsTransactionId = (fixes.at(-1) ?? original).transactionId;
  const fixKey = `${original.key}:fix:${fixes.length + 1}`;
  await ensureBranchLocations(ctx, original.branchId);

  return runOnce(ctx, { key, operation: 'inventory.serviceUse.correct' }, async (session) => {
    const options = { actor: me(ctx), note, correctsTransactionId };
    const { transaction } =
      delta > 0
        ? await postServiceUse(ctx, { ...pickUse(original), key: fixKey, qty: delta }, { ...options, correctsConsumptionId: original._id }, session)
        : await giveBackServiceUse(ctx, original, -delta, { ...options, key: fixKey }, session);
    await recordInventoryAction(
      ctx,
      {
        action: 'inventory.service_use_corrected',
        branchId: original.branchId,
        summary: `Corrected ${sku.name} used for ${original.serviceName} (${original.staffName}): ${describeQty(current, sku)} → ${describeQty(actualQty, sku)}${note ? `. ${note}` : ''}`,
        link: `/app/inventory?tab=products&product=${sku._id}`,
      },
      session
    );
    return { transactionId: transaction._id, usedQty: actualQty };
  });
}
