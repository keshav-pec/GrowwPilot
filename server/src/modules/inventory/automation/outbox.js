import mongoose from 'mongoose';
import { Appointment, InventoryConsumptionEvent, InventoryException, InventoryOutbox, InventorySku } from '../../../models/index.js';
import { scoped } from '../../../utils/scoped.js';
import { notify } from '../../notifications/notifications.service.js';
import { findRecipeInEffect } from '../recipes/recipes.service.js';
import { ensureBranchLocations } from '../locations/locations.service.js';
import { stockKeeperIds } from '../stock/lowStock.js';
import { EXCEPTION_REASON, postServiceUse } from './serviceUse.js';

// ---------------------------------------------------------------------------
// Automatic use when a service is completed.
// 1. Completing an appointment writes one "service completed" event, in the same transaction (the outbox).
// 2. Right after, it is handled in the background, so the front desk never waits for it.
// 3. A sweep every few minutes retries anything that failed (or was cut off by a restart).
// Each service line and recipe line is posted at most once (a unique key), so replaying an event is safe (AC28).
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const STALE_AFTER_MS = 5 * 60 * 1000; // a PROCESSING event this old was cut off: try it again
const SWEEP_EVERY_MS = 3 * 60 * 1000;

// Called inside the appointment's transaction when it moves to Completed (only with the add-on on)
export async function enqueueServiceCompleted(ctx, appointment, session) {
  const now = new Date();
  await InventoryOutbox.updateOne(
    scoped(ctx, { dedupeKey: `appointment:${appointment._id}:completed` }),
    {
      $setOnInsert: {
        branchId: appointment.branchId,
        type: 'SERVICE_COMPLETED',
        appointmentId: appointment._id,
        completedAt: now,
        completedBy: { id: ctx.userId, name: ctx.userName },
        status: 'PENDING',
        nextAttemptAt: now,
      },
    },
    { upsert: true, session }
  );
}

// Handle waiting events in the background, without making the caller wait
export function processSoon() {
  setImmediate(() => processOutbox().catch((err) => console.error('Inventory automation:', err)));
}

// Handles every event that is due, one at a time. Returns how many were handled.
export async function processOutbox() {
  let handled = 0;
  for (let event = await claimNext(); event; event = await claimNext()) {
    await processEvent(event);
    handled += 1;
  }
  return handled;
}

// Takes the next due event so no one else handles it at the same time
function claimNext() {
  const now = new Date();
  return InventoryOutbox.findOneAndUpdate(
    {
      $or: [
        { status: 'PENDING', nextAttemptAt: { $lte: now } },
        { status: 'FAILED', attempts: { $lt: MAX_ATTEMPTS }, nextAttemptAt: { $lte: now } },
        { status: 'PROCESSING', lockedAt: { $lt: new Date(now - STALE_AFTER_MS) } },
      ],
    },
    { $set: { status: 'PROCESSING', lockedAt: now }, $inc: { attempts: 1 } },
    { sort: { createdAt: 1 }, returnDocument: 'after' }
  ).lean();
}

async function processEvent(event) {
  try {
    await handleServiceCompleted(event);
    await InventoryOutbox.updateOne({ _id: event._id, status: 'PROCESSING' }, { $set: { status: 'DONE', processedAt: new Date(), lastError: null } });
  } catch (err) {
    // Try again later, waiting longer each time (1, 2, 4, 8 minutes); after that a person can press Retry
    const wait = 60_000 * 2 ** (event.attempts - 1);
    await InventoryOutbox.updateOne(
      { _id: event._id, status: 'PROCESSING' },
      { $set: { status: 'FAILED', lastError: err.message, nextAttemptAt: new Date(Date.now() + wait) } }
    );
  }
}

// The background job acts as the person who completed the appointment, at that branch
function automationCtx(event) {
  return {
    orgId: String(event.orgId),
    userId: String(event.completedBy.id),
    userName: event.completedBy.name,
    role: 'SYSTEM',
    isPrimaryOwner: false,
    allowedBranchIds: [String(event.branchId)],
    activeBranchId: String(event.branchId),
  };
}

export async function handleServiceCompleted(event) {
  const appointment = await Appointment.findOne({ _id: event.appointmentId, orgId: event.orgId }).lean();
  if (!appointment || appointment.status !== 'COMPLETED') return; // nothing is used for cancelled visits

  const ctx = automationCtx(event);
  const actor = { id: event.completedBy.id, name: event.completedBy.name, role: 'Automatic (service completed)' };
  await ensureBranchLocations(ctx, appointment.branchId);

  // Each item is one service done (a combo is several), at the branch where it was done
  for (const item of appointment.items) {
    const recipe = await findRecipeInEffect(ctx, { serviceId: item.serviceId, branchId: appointment.branchId, at: event.completedAt });
    if (!recipe) continue;
    for (const line of recipe.lines.filter((l) => l.deducts)) {
      const use = {
        key: [event.orgId, appointment.branchId, appointment._id, item._id, line._id].join(':'),
        branchId: appointment.branchId,
        appointmentId: appointment._id,
        serviceLineId: item._id,
        serviceId: item.serviceId,
        serviceName: item.serviceName,
        staffId: item.staffId,
        staffName: item.staffName,
        recipeId: recipe._id,
        recipeVersion: recipe.version,
        recipeLineId: line._id,
        skuId: line.skuId,
        qty: line.qty,
        useStoreIfNeeded: line.useStoreIfNeeded,
        completedAt: event.completedAt,
      };
      await takeOnce(ctx, use, actor);
    }
  }
}

async function takeOnce(ctx, use, actor) {
  // Already used, or already waiting in (or dealt with from) the exceptions list
  if (await InventoryConsumptionEvent.exists(scoped(ctx, { key: use.key }))) return;
  if (await InventoryException.exists(scoped(ctx, { key: use.key }))) return;

  try {
    await mongoose.connection.transaction((session) => postServiceUse(ctx, use, { actor }, session));
  } catch (err) {
    if (err.code === 11000) return; // posted by another run at the same moment
    const reason = EXCEPTION_REASON[err.code];
    if (!reason) throw err; // something unexpected: the whole event is retried later
    await openException(ctx, use, reason, err.message);
  }
}

// Not enough stock (or similar): nothing goes below zero; it waits in the exceptions list
async function openException(ctx, use, reason, message) {
  const sku = await InventorySku.findOne(scoped(ctx, { _id: use.skuId })).select('name').lean();
  const result = await InventoryException.updateOne(
    scoped(ctx, { key: use.key }),
    { $setOnInsert: { ...use, skuName: sku?.name, reason, message, status: 'OPEN' } },
    { upsert: true }
  );
  if (result.upsertedCount > 0) {
    await notify(ctx, await stockKeeperIds(ctx, use.branchId), {
      message: `${use.serviceName} (${use.staffName}) couldn’t take its stock: ${message}`,
      link: '/app/inventory?tab=overview',
    });
  }
}

// Started once when the server starts: handle what is waiting, then sweep every few minutes
export function startInventoryAutomation() {
  processSoon();
  setInterval(() => processOutbox().catch((err) => console.error('Inventory automation:', err)), SWEEP_EVERY_MS).unref();
}
