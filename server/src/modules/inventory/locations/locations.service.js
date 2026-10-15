import { InventoryAllocation, InventoryBalance, InventoryLocation } from '../../../models/index.js';
import { AppError } from '../../../utils/AppError.js';
import { scoped } from '../../../utils/scoped.js';
import { escapeRegex } from '../../../utils/regex.js';
import { runOnce } from '../../../middleware/idempotency.js';
import { assertCan } from '../permissions.js';
import { getBranchSettings } from '../settings/settings.service.js';
import { recordInventoryAction } from '../activity.js';

const SETTINGS_LINK = '/app/inventory?tab=settings';

// Every branch has a "Main store" and an "In use" place. Made the first time a branch uses Inventory
// (so branches that existed before the add-on get them too). Safe to call any number of times.
export async function ensureBranchLocations(ctx, branchId) {
  const defaults = [
    [{ isMain: true }, { kind: 'STORE', name: 'Main store' }],
    [{ kind: 'IN_USE' }, { name: 'In use' }],
  ];
  for (const [match, fields] of defaults) {
    try {
      await InventoryLocation.updateOne(scoped(ctx, { branchId, ...match }), { $setOnInsert: fields }, { upsert: true });
    } catch (err) {
      if (err.code !== 11000) throw err; // made by another request at the same moment: fine
    }
  }
  const [mainStore, inUse] = await Promise.all([
    InventoryLocation.findOne(scoped(ctx, { branchId, isMain: true })).lean(),
    InventoryLocation.findOne(scoped(ctx, { branchId, kind: 'IN_USE' })).lean(),
  ]);
  return { mainStore, inUse };
}

const KIND_ORDER = { STORE: 0, IN_USE: 1, STATION: 2 };

// The selected branch's places: stores first (main store on top), then In use, then stations
export async function listLocations(ctx) {
  const branchId = ctx.activeBranchId;
  await ensureBranchLocations(ctx, branchId);
  const locations = await InventoryLocation.find(scoped(ctx, { branchId })).sort({ name: 1 }).lean();
  return locations.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.isMain - a.isMain);
}

async function assertCanManage(ctx) {
  assertCan(ctx, 'inventory.manageSettings', { settings: await getBranchSettings(ctx, ctx.activeBranchId) });
}

async function assertNameFree(ctx, branchId, name, exceptId) {
  const filter = scoped(ctx, { branchId, name: new RegExp(`^${escapeRegex(name)}$`, 'i') });
  if (exceptId) filter._id = { $ne: exceptId };
  if (await InventoryLocation.exists(filter)) throw new AppError(409, 'NAME_TAKEN', `There is already a place called “${name}” at this branch`);
}

const KIND_LABEL = { STORE: 'store', STATION: 'station' };

// Owners add more stores ("Back room") and name stations ("Chair 3", "Colour bar")
export async function createLocation(ctx, { kind, name }, key) {
  await assertCanManage(ctx);
  const branchId = ctx.activeBranchId;
  await ensureBranchLocations(ctx, branchId);
  await assertNameFree(ctx, branchId, name);

  return runOnce(ctx, { key, operation: 'inventory.location.create' }, async (session) => {
    const [location] = await InventoryLocation.create([{ orgId: ctx.orgId, branchId, kind, name }], { session });
    await recordInventoryAction(ctx, { action: 'inventory.location_added', branchId, summary: `Added the ${KIND_LABEL[kind]} “${name}”`, link: SETTINGS_LINK }, session);
    return { location };
  });
}

// Rename, or stop using a place. Main store and In use are always there.
// A store that still holds stock, or a station with open hand-outs, can't be closed.
export async function updateLocation(ctx, id, { name, active }, key) {
  await assertCanManage(ctx);
  const location = await InventoryLocation.findOne(scoped(ctx, { _id: id, branchId: ctx.activeBranchId })).lean();
  if (!location) throw new AppError(404, 'NOT_FOUND', 'Place not found');

  if (name && name !== location.name) await assertNameFree(ctx, location.branchId, name, location._id);
  if (active === false && location.active) {
    if (location.isMain || location.kind === 'IN_USE') throw new AppError(409, 'LOCATION_REQUIRED', `${location.name} is always needed and can't be closed`);
    if (location.kind === 'STORE' && (await InventoryBalance.exists(scoped(ctx, { locationId: location._id, qty: { $gt: 0 } })))) {
      throw new AppError(409, 'LOCATION_HAS_STOCK', `${location.name} still has stock. Move it out first.`);
    }
    if (location.kind === 'STATION' && (await InventoryAllocation.exists(scoped(ctx, { 'recipient.kind': 'STATION', 'recipient.id': location._id, status: 'OPEN' })))) {
      throw new AppError(409, 'LOCATION_HAS_STOCK', `${location.name} still has products in use. Finish, return or move them first.`);
    }
  }

  const renamed = name !== undefined && name !== location.name;
  const closed = active === false && location.active;
  const reopened = active === true && !location.active;
  if (!renamed && !closed && !reopened) return { location }; // nothing to change

  return runOnce(ctx, { key, operation: 'inventory.location.update' }, async (session) => {
    const changes = { ...(renamed && { name }), ...((closed || reopened) && { active }) };
    const updated = await InventoryLocation.findOneAndUpdate(scoped(ctx, { _id: id }), { $set: changes }, { returnDocument: 'after', session }).lean();

    const what = KIND_LABEL[location.kind] ?? 'place';
    const summary = [
      renamed && `Renamed the ${what} “${location.name}” to “${name}”`,
      closed && `Closed the ${what} “${updated.name}”`,
      reopened && `Reopened the ${what} “${updated.name}”`,
    ]
      .filter(Boolean)
      .join('. ');
    await recordInventoryAction(ctx, { action: 'inventory.location_changed', branchId: location.branchId, summary, before: { name: location.name, active: location.active }, after: changes, link: SETTINGS_LINK }, session);
    return { location: updated };
  });
}
