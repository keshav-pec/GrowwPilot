// Inventory add-on, Phase 5: service recipes and automatic use when a service is completed.
// PRD tests: AC10-AC14, AC23, AC28, plus exceptions when stock is short and recipe overlaps.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import {
  InventoryAllocation,
  InventoryConsumptionEvent,
  InventoryException,
  InventoryOutbox,
  Notification,
  Organization,
  Service,
  User,
} from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { reconcile } from '../src/modules/inventory/stock/stock.engine.js';
import { processOutbox } from '../src/modules/inventory/automation/outbox.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
const tomorrow = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();

let server;
let api;
let f;
let store;
const cookies = {};
const users = {};
const sku = {}; // products at Andheri
const svc = {}; // services offered everywhere

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}

const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

async function call(who, method, path, { body, branch, key = method === 'GET' ? null : newKey() } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who] };
  if (branch) headers['x-branch-id'] = String(branch);
  if (key) headers['idempotency-key'] = key;
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

async function addProduct(name, body) {
  const res = await call('business', 'POST', '/inventory/skus', { body: { name, category: 'Salon', stockUnit: 'piece', ...body } });
  if (res.status !== 201) throw new Error(JSON.stringify(res.json));
  return res.json.sku;
}

const inStore = async (product) => (await call('business', 'GET', `/inventory/skus/${product._id}`)).json.totals.inStore;

async function setRecipe(who, serviceId, lines, { scope = 'salon', branch, effectiveFrom } = {}) {
  return call(who, 'POST', '/inventory/recipes', { body: { serviceId, scope, lines, effectiveFrom }, branch });
}

// Book tomorrow (15-minute slots, so stylists never clash) and take it all the way to Completed
let slot = 0;
async function book(items, { branch, comboId } = {}) {
  const at = DateTime.fromObject({ hour: 10 }).plus({ minutes: 15 * slot++ }).toFormat('HH:mm');
  const res = await call('business', 'POST', '/appointments', {
    body: { customerId: String(f.priya._id), date: tomorrow, startTime: at, items: items.map((i) => ({ durationMinutes: 15, ...i })), comboId },
    branch,
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.json));
  return res.json.appointment;
}

async function moveTo(appointment, statuses, branch) {
  for (const status of statuses) {
    const res = await call('business', 'PATCH', `/appointments/${appointment._id}/status`, { body: { status }, branch });
    if (res.status !== 200) throw new Error(JSON.stringify(res.json));
  }
}

// Wait until the background job has handled every event
async function settle() {
  await processOutbox();
  for (let i = 0; i < 100 && (await InventoryOutbox.exists({ status: { $in: ['PENDING', 'PROCESSING'] } })); i++) {
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function complete(items, options) {
  const appointment = await book(items, options);
  await moveTo(appointment, ['ARRIVED', 'IN_SERVICE', 'COMPLETED'], options?.branch);
  await settle();
  return appointment;
}

const by = (staff) => (service) => ({ serviceId: String(service._id), staffId: String(staff._id) });

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  await Organization.updateOne({ _id: f.ctxGlamour.orgId }, { $set: { 'addons.inventory.enabled': true } });
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const created = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'INVENTORY', name: 'Suresh', email: 'suresh@g.com', passwordHash, branchIds: [f.andheri._id] },
  ]);
  ['business', 'bandraOwner', 'desk', 'inventory'].forEach((who, i) => (users[who] = created[i]));
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const who of Object.keys(users)) cookies[who] = await login(users[who].email);

  [svc.cleanup, svc.touchUp, svc.blowDry] = await Service.create([
    { orgId: g, name: 'Clean-up', durationMinutes: 15, price: 50000 },
    { orgId: g, name: 'Root touch-up', durationMinutes: 15, price: 150000 },
    { orgId: g, name: 'Blow dry', durationMinutes: 15, price: 40000 },
  ]);
  svc.haircut = f.haircut;
  svc.beardTrim = f.beardTrim;
  sku.kit = await addProduct('Facial kit', { stockUnit: 'kit', wayOfUse: 'SERVICE_UNITS', openingQty: 5 });
  sku.blade = await addProduct('Blade', { wayOfUse: 'SERVICE_UNITS', openingQty: 10 });
  sku.developer = await addProduct('Developer 6%', { stockUnit: 'bottle', wayOfUse: 'SERVICE_MEASURED', baseUnit: 'ml', unitsPerStockUnit: 1000, openingQty: 2000 });
  sku.shampoo = await addProduct('Shampoo', { stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty: 10 });
  store = (await call('business', 'GET', '/inventory/locations')).json.locations.find((l) => l.isMain);
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

const rahul = () => by(f.rahul);
const neha = () => by(f.neha);

describe('Who may set recipes', () => {
  it('the business owner sets salon-wide recipes; a branch owner only their branch’s', async () => {
    expect((await setRecipe('business', svc.cleanup._id, [{ skuId: sku.kit._id, qty: 1 }])).status).toBe(201);
    expect((await setRecipe('bandraOwner', svc.blowDry._id, [{ skuId: sku.kit._id, qty: 1 }], { branch: f.bandra._id })).status).toBe(403);
    expect((await setRecipe('bandraOwner', svc.blowDry._id, [{ skuId: sku.kit._id, qty: 1 }], { scope: 'branch', branch: f.bandra._id })).status).toBe(201);
  });

  it('an inventory login can see recipes but not change them; the front desk can’t see them', async () => {
    const res = await call('inventory', 'GET', '/inventory/recipes');
    expect(res.status).toBe(200);
    const cleanup = res.json.services.find((s) => s.service.name === 'Clean-up');
    expect(cleanup.applies).toBe('salon');
    expect(cleanup.salon.current.lines[0]).toMatchObject({ qty: 1, deducts: true, sku: { name: 'Facial kit' } });
    expect((await setRecipe('inventory', svc.cleanup._id, [])).status).toBe(403);
    expect((await call('desk', 'GET', '/inventory/recipes')).status).toBe(403);
  });
});

describe('Automatic use when a service is completed', () => {
  let first;

  it('AC10: completing a clean-up uses exactly one facial kit', async () => {
    first = await complete([rahul()(svc.cleanup)]);
    expect(await inStore(sku.kit)).toBe(4);
    const uses = await InventoryConsumptionEvent.find({ appointmentId: first._id }).lean();
    expect(uses).toHaveLength(1);
    expect(uses[0]).toMatchObject({ qty: 1, recipeVersion: 1, staffName: 'Rahul', serviceName: 'Clean-up' });
  });

  it('AC11 / AC28: handling the same completion again uses nothing more', async () => {
    await InventoryOutbox.updateOne({ appointmentId: first._id }, { $set: { status: 'PENDING', nextAttemptAt: new Date() } });
    await settle();
    expect(await inStore(sku.kit)).toBe(4);
    expect(await InventoryConsumptionEvent.countDocuments({ appointmentId: first._id })).toBe(1);
  });

  it('AC28: a failed event shows up for a retry, and the retry doesn’t use stock twice', async () => {
    await InventoryOutbox.updateOne({ appointmentId: first._id }, { $set: { status: 'FAILED', attempts: 5, lastError: 'Database went away' } });
    const { failedEvents } = (await call('inventory', 'GET', '/inventory/automation')).json;
    expect(failedEvents.map((e) => e.lastError)).toEqual(['Database went away']);
    expect((await call('inventory', 'POST', `/inventory/automation/events/${failedEvents[0]._id}/retry`)).status).toBe(200);
    await settle();
    expect((await InventoryOutbox.findById(failedEvents[0]._id).lean()).status).toBe('DONE');
    expect(await inStore(sku.kit)).toBe(4);
  });

  it('AC12: a cancelled booking uses nothing', async () => {
    const appointment = await book([rahul()(svc.cleanup)]);
    await moveTo(appointment, ['CANCELLED']);
    await settle();
    expect(await InventoryOutbox.exists({ appointmentId: appointment._id })).toBeFalsy();
    expect(await inStore(sku.kit)).toBe(4);
  });

  it('AC13: a finish-mode shampoo can only be linked to a service, and is never taken per wash', async () => {
    const refused = await setRecipe('business', svc.haircut._id, [{ skuId: sku.shampoo._id, qty: 1, deducts: true }]);
    expect(refused.json.error.code).toBe('RECIPE_LINK_ONLY');
    expect((await setRecipe('business', svc.haircut._id, [{ skuId: sku.shampoo._id, deducts: false }])).status).toBe(201);
    await complete([rahul()(svc.haircut)]);
    expect(await inStore(sku.shampoo)).toBe(10);
  });

  it('a combo uses stock for each service done', async () => {
    await setRecipe('business', svc.beardTrim._id, [{ skuId: sku.blade._id, qty: 1 }]);
    await setRecipe('business', svc.haircut._id, [{ skuId: sku.shampoo._id, deducts: false }, { skuId: sku.blade._id, qty: 1 }]);
    await complete([rahul()(svc.haircut), neha()(svc.beardTrim)], { comboId: String(f.combo._id) });
    expect(await inStore(sku.blade)).toBe(8); // 1 for the haircut + 1 for the beard trim
    expect(await inStore(sku.shampoo)).toBe(10);
  });

  it('a branch recipe wins over the salon-wide one', async () => {
    await setRecipe('business', svc.cleanup._id, [{ skuId: sku.kit._id, qty: 2 }], { scope: 'branch' });
    await complete([rahul()(svc.cleanup)]);
    expect(await inStore(sku.kit)).toBe(2);
    await call('business', 'POST', '/inventory/recipes/end', { body: { serviceId: String(svc.cleanup._id), scope: 'branch' } });
  });

  it('nothing is taken when the add-on is off', async () => {
    await Organization.updateOne({ _id: f.ctxGlamour.orgId }, { $set: { 'addons.inventory.enabled': false } });
    const appointment = await complete([rahul()(svc.blowDry)]);
    expect(await InventoryOutbox.exists({ appointmentId: appointment._id })).toBeFalsy();
    await Organization.updateOne({ _id: f.ctxGlamour.orgId }, { $set: { 'addons.inventory.enabled': true } });
  });
});

describe('Measured products (AC14)', () => {
  let handout;
  let firstUse;

  it('takes the exact ml from an open bottle first, the stylist’s own one before others', async () => {
    await setRecipe('business', svc.touchUp._id, [{ skuId: sku.developer._id, qty: 60 }]);
    const issued = await call('business', 'POST', '/inventory/allocations', { body: { skuId: sku.developer._id, locationId: store._id, recipient: { kind: 'STAFF', id: String(f.rahul._id) }, qty: 1000 } });
    handout = issued.json.allocation;

    const appointment = await complete([rahul()(svc.touchUp)]);
    expect((await InventoryAllocation.findById(handout._id).lean()).remainingQty).toBe(940);
    expect(await inStore(sku.developer)).toBe(1000); // the store isn't touched
    firstUse = await InventoryConsumptionEvent.findOne({ appointmentId: appointment._id }).lean();
    expect(firstUse.sources.map((s) => [String(s.allocationId), s.qty])).toEqual([[handout._id, 60]]);

    // Neha has no open bottle: the oldest open one is used
    await complete([neha()(svc.touchUp)]);
    expect((await InventoryAllocation.findById(handout._id).lean()).remainingQty).toBe(880);
  });

  it('a correction posts only the difference, linked to the original', async () => {
    const more = await call('inventory', 'POST', `/inventory/automation/uses/${firstUse._id}/correct`, { body: { actualQty: 110, note: 'Long hair' } });
    expect(more.json.usedQty).toBe(110);
    expect((await InventoryAllocation.findById(handout._id).lean()).remainingQty).toBe(830); // only 50 more
    const fewer = await call('business', 'POST', `/inventory/automation/uses/${firstUse._id}/correct`, { body: { actualQty: 100 } });
    expect(fewer.status).toBe(200);
    expect((await InventoryAllocation.findById(handout._id).lean()).remainingQty).toBe(840); // 10 back into the bottle
    const fixes = await InventoryConsumptionEvent.find({ correctsId: firstUse._id }).sort({ createdAt: 1 }).lean();
    expect(fixes.map((x) => x.qty)).toEqual([50, -10]);
    expect((await call('business', 'POST', `/inventory/automation/uses/${firstUse._id}/correct`, { body: { actualQty: 100 } })).status).toBe(400);
  });

  it('the product history links the use so it can be corrected', async () => {
    const { items } = (await call('business', 'GET', `/inventory/skus/${sku.developer._id}/movements`)).json;
    const use = items.find((m) => m.type === 'SERVICE_USE' && m.serviceUse?._id === String(firstUse._id));
    expect(use.serviceUse.serviceName).toBe('Root touch-up');
  });

  it('with no open bottle and “don’t take from the store”, it goes to the exceptions list', async () => {
    await call('business', 'POST', `/inventory/allocations/${handout._id}/return`, { body: { qty: 840 } });
    await setRecipe('business', svc.touchUp._id, [{ skuId: sku.developer._id, qty: 60, useStoreIfNeeded: false }]);
    const appointment = await complete([rahul()(svc.touchUp)]);
    const exception = await InventoryException.findOne({ appointmentId: appointment._id }).lean();
    expect(exception).toMatchObject({ reason: 'NO_OPEN_HANDOUT', status: 'OPEN', qty: 60 });
  });
});

describe('Exceptions when stock is short (and AC23)', () => {
  let exception;

  it('never goes below zero: the line waits in the exceptions list and the team is told', async () => {
    await setRecipe('business', svc.blowDry._id, [{ skuId: sku.kit._id, qty: 3 }]); // only 2 kits left
    const appointment = await complete([rahul()(svc.blowDry)]);
    expect(await inStore(sku.kit)).toBe(2);
    exception = await InventoryException.findOne({ appointmentId: appointment._id }).lean();
    expect(exception).toMatchObject({ reason: 'NOT_ENOUGH_STOCK', status: 'OPEN', qty: 3, skuName: 'Facial kit', recipeVersion: 1 });
    expect(await Notification.exists({ userId: users.inventory._id, message: /Blow dry \(Rahul\) couldn’t take its stock/ })).toBeTruthy();
  });

  it('AC23: changing the recipe doesn’t change past uses, or what is waiting', async () => {
    await setRecipe('business', svc.blowDry._id, [{ skuId: sku.kit._id, qty: 5 }]);
    const past = await InventoryConsumptionEvent.find({ serviceName: 'Clean-up', correctsId: null }).sort({ createdAt: 1 }).lean();
    expect(past[0]).toMatchObject({ recipeVersion: 1, qty: 1 });
  });

  it('after restocking, Post now takes what the recipe said at the time (3, not 5)', async () => {
    await call('business', 'POST', '/inventory/movements/write-offs', { body: { skuId: sku.kit._id, locationId: store._id, qty: 4, reason: 'STOCK_COUNT_CORRECTION', direction: 'ADD' } });
    expect((await call('desk', 'POST', `/inventory/automation/exceptions/${exception._id}/post`)).status).toBe(403);
    const posted = await call('inventory', 'POST', `/inventory/automation/exceptions/${exception._id}/post`);
    expect(posted.json.status).toBe('POSTED');
    expect(await inStore(sku.kit)).toBe(3);
    expect((await call('inventory', 'POST', `/inventory/automation/exceptions/${exception._id}/post`)).json.error.code).toBe('ALREADY_DECIDED');
  });

  it('only owners dismiss an exception, with a reason', async () => {
    const waiting = await InventoryException.findOne({ reason: 'NO_OPEN_HANDOUT', status: 'OPEN' }).lean();
    expect((await call('inventory', 'POST', `/inventory/automation/exceptions/${waiting._id}/dismiss`, { body: { note: 'Used a sample' } })).status).toBe(403);
    expect((await call('business', 'POST', `/inventory/automation/exceptions/${waiting._id}/dismiss`, { body: { note: 'Used a sample' } })).json.status).toBe('DISMISSED');
    expect((await call('business', 'GET', '/inventory/automation')).json.exceptions).toEqual([]);
  });

  it('stock is always taken from the branch where the service happened', async () => {
    // Bandra doesn't stock facial kits: the Bandra blow dry (Bandra's own recipe) waits as an exception there
    const appointment = await complete([by(f.arjun)(svc.blowDry)], { branch: f.bandra._id });
    const waiting = await InventoryException.findOne({ appointmentId: appointment._id }).lean();
    expect(waiting).toMatchObject({ reason: 'NOT_STOCKED_HERE', branchId: f.bandra._id });
    expect(await inStore(sku.kit)).toBe(3); // Andheri untouched
  });
});

describe('Recipe versions', () => {
  it('refuses overlapping versions and start times in the past', async () => {
    const later = DateTime.now().plus({ days: 2 }).toISO();
    expect((await setRecipe('business', svc.beardTrim._id, [{ skuId: sku.blade._id, qty: 2 }], { effectiveFrom: later })).status).toBe(201);
    const sooner = DateTime.now().plus({ days: 1 }).toISO();
    expect((await setRecipe('business', svc.beardTrim._id, [{ skuId: sku.blade._id, qty: 3 }], { effectiveFrom: sooner })).json.error.code).toBe('RECIPE_CONFLICT');
    const past = DateTime.now().minus({ days: 1 }).toISO();
    expect((await setRecipe('business', svc.beardTrim._id, [{ skuId: sku.blade._id, qty: 3 }], { effectiveFrom: past })).status).toBe(400);

    const beard = (await call('business', 'GET', '/inventory/recipes')).json.services.find((s) => s.service.name === 'Beard Trim');
    expect(beard.salon.current.lines[0].qty).toBe(1);
    expect(beard.salon.upcoming.map((v) => v.lines[0].qty)).toEqual([2]);
    const history = (await call('business', 'GET', `/inventory/recipes/history?serviceId=${svc.beardTrim._id}&scope=salon`)).json.versions;
    expect(history.map((v) => v.version)).toEqual([2, 1]);
    expect(history[1].effectiveTo).toBe(history[0].effectiveFrom); // the old one ends where the new one starts
  });
});

it('AC24: every balance still matches the movement history', async () => {
  expect(await reconcile(f.ctxGlamour)).toEqual([]);
});

