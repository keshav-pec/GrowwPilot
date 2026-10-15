// Inventory add-on, Phase 4: daily stock work. Issue, finish & replace, return, move, write-offs,
// problem reports, approvals, corrections, low stock and staff leaving.
// PRD tests: AC02-AC09, AC16, AC17, AC18, AC25, AC26 (and AC24 at the end).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { InventoryAllocation, InventoryLedgerEntry, InventorySettings, InventoryTransaction, Notification, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { reconcile } from '../src/modules/inventory/stock/stock.engine.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';

let server;
let api;
let f;
let store; // Andheri's main store
let chair; // a station at Andheri
const cookies = {};
const users = {};

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

async function addProduct(name, { openingQty = 10, cost = 50000, ...extra } = {}) {
  const res = await call('business', 'POST', '/inventory/skus', {
    body: { name, category: 'Hair care', stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty, ...(cost != null && { openingUnitCost: cost }), ...extra },
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.json));
  return res.json.sku;
}

const totals = async (sku, who = 'business') => (await call(who, 'GET', `/inventory/skus/${sku._id}`)).json.totals;
const rahul = () => ({ kind: 'STAFF', id: String(f.rahul._id) });

async function issue(sku, { who = 'business', qty = 1, recipient = rahul() } = {}) {
  return call(who, 'POST', '/inventory/allocations', { body: { skuId: sku._id, locationId: store._id, recipient, qty } });
}

async function issued(sku, options) {
  const res = await issue(sku, options);
  if (res.status !== 201) throw new Error(JSON.stringify(res.json));
  return res.json.allocation;
}

const finish = (allocation, body = { qty: 1 }, { who = 'business', key } = {}) => call(who, 'POST', `/inventory/allocations/${allocation._id}/finish`, { body, key });

// Sum of history lines for a product by what they mean (CONSUMED, WASTED...)
async function bucketTotal(sku, bucket) {
  const lines = await InventoryLedgerEntry.find({ skuId: sku._id, bucket }).lean();
  return lines.reduce((sum, l) => sum + l.qty, 0);
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  await Organization.updateMany({}, { $set: { 'addons.inventory.enabled': true } });
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const created = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'INVENTORY', name: 'Suresh', email: 'suresh@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Layla', email: 'layla@d.com', passwordHash, allBranches: true },
  ]);
  ['business', 'bandraOwner', 'desk', 'inventory', 'desert'].forEach((who, i) => (users[who] = created[i]));
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const who of Object.keys(users)) cookies[who] = await login(users[who].email);

  const { locations } = (await call('business', 'GET', '/inventory/locations')).json;
  store = locations.find((l) => l.isMain);
  chair = (await call('business', 'POST', '/inventory/locations', { body: { kind: 'STATION', name: 'Chair 3' } })).json.location;
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('Issue and finish (AC02, AC03, AC25)', () => {
  let sku;
  let handout;

  it('AC02: issuing one moves it from the store to In use; the total stays 10', async () => {
    sku = await addProduct('Shampoo');
    handout = await issued(sku);
    expect(handout).toMatchObject({ remainingQty: 1, status: 'OPEN', recipient: { kind: 'STAFF', name: 'Rahul' } });
    expect(await totals(sku)).toMatchObject({ inStore: 9, inUse: 1 });
  });

  it('AC03: finishing it uses it up: store 9, in use 0, total 9, consumed 1', async () => {
    const res = await finish(handout);
    expect(res.json.replacement.status).toBe('NOT_REQUESTED');
    expect(res.json.allocation.status).toBe('CLOSED');
    expect(res.json.totals).toMatchObject({ inStore: 9, inUse: 0 });
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(-1);
  });

  it('AC25: a closed hand-out can’t be finished again', async () => {
    expect((await finish(handout)).json.error.code).toBe('ALLOCATION_ALREADY_CLOSED');
  });

  it("can't issue more than is in the store", async () => {
    const res = await issue(sku, { qty: 50 });
    expect(res.json.error.code).toBe('INSUFFICIENT_AVAILABLE_STOCK');
    expect(await totals(sku)).toMatchObject({ inStore: 9, inUse: 0 });
  });

  it('hands out to a station or the salon floor too', async () => {
    expect((await issued(sku, { recipient: { kind: 'STATION', id: chair._id } })).recipient.name).toBe('Chair 3');
    expect((await issued(sku, { recipient: { kind: 'FLOOR' } })).recipient.name).toBe('Salon floor');
    // Another branch's stylist can't receive it
    expect((await issue(sku, { recipient: { kind: 'STAFF', id: String(f.arjun._id) } })).status).toBe(404);
  });
});

describe('Finish & replace (AC04, AC05, AC06, AC07)', () => {
  it('AC04: finish & replace: store 8, in use 1, consumed 1', async () => {
    const sku = await addProduct('Conditioner');
    const handout = await issued(sku);
    const res = await finish(handout, { qty: 1, replacement: { qty: 1 } });
    expect(res.json.replacement.status).toBe('ISSUED');
    expect(res.json.totals).toMatchObject({ inStore: 8, inUse: 1 });
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(-1);
    const replacement = await InventoryAllocation.findById(res.json.replacement.allocationId).lean();
    expect(replacement.remainingQty).toBe(1);
    expect(String(replacement.replacesId)).toBe(handout._id);
  });

  it('AC05: with nothing left in the store, the finish is still saved and low stock is raised', async () => {
    const sku = await addProduct('Wax jar', { openingQty: 1 });
    const handout = await issued(sku);
    const res = await finish(handout, { qty: 1, replacement: { qty: 1 } });
    expect(res.status).toBe(200);
    expect(res.json.replacement).toMatchObject({ status: 'UNAVAILABLE', allocationId: null });
    expect(res.json.totals).toMatchObject({ inStore: 0, inUse: 0 });
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(-1);
    expect(await Notification.exists({ userId: users.inventory._id, message: /Low stock: Wax jar, none left in store/ })).toBeTruthy();
  });

  it('AC06: the same finish sent twice uses and replaces only once', async () => {
    const sku = await addProduct('Serum');
    const handout = await issued(sku);
    const key = newKey();
    const first = await finish(handout, { qty: 1, replacement: { qty: 1 } }, { key });
    const again = await finish(handout, { qty: 1, replacement: { qty: 1 } }, { key });
    expect(again.json).toEqual(first.json);
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(-1);
    expect(await InventoryAllocation.countDocuments({ skuId: sku._id })).toBe(2);
    expect(await totals(sku)).toMatchObject({ inStore: 8, inUse: 1 });
  });

  it('AC07: people finishing the same bottle at the same moment can’t use more than was handed out', async () => {
    const sku = await addProduct('Hair spray');
    const handout = await issued(sku, { qty: 2 });
    const results = await Promise.all(Array.from({ length: 5 }, () => finish(handout, { qty: 1 })));
    expect(results.filter((r) => r.status === 200)).toHaveLength(2);
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(-2);
    expect(await totals(sku)).toMatchObject({ inStore: 8, inUse: 0 });
  });
});

describe('Move and return (AC08, AC09)', () => {
  let sku;
  let handout;
  beforeAll(async () => {
    sku = await addProduct('Gel');
    handout = await issued(sku, { qty: 3 });
  });

  it('AC08: moving to someone else keeps the branch total and records who has it', async () => {
    const res = await call('inventory', 'POST', `/inventory/allocations/${handout._id}/move`, { body: { recipient: { kind: 'STATION', id: chair._id }, qty: 2 } });
    expect(res.status).toBe(200);
    expect(res.json.allocation.remainingQty).toBe(1); // Rahul keeps 1
    expect(res.json.moved).toMatchObject({ remainingQty: 2, recipient: { name: 'Chair 3' } });
    expect(await totals(sku)).toMatchObject({ inStore: 7, inUse: 3 });
    const transfer = await InventoryTransaction.findOne({ type: 'TRANSFER', 'reference.id': handout._id }).lean();
    expect(transfer.heldBy.name).toBe('Chair 3');
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(0);
  });

  it('AC09: returning unused stock puts it back in the store', async () => {
    const res = await call('business', 'POST', `/inventory/allocations/${handout._id}/return`, { body: { qty: 1 } });
    expect(res.json.allocation.status).toBe('CLOSED');
    expect(res.json.totals).toMatchObject({ inStore: 8, inUse: 2 });
  });

  it('lists open hand-outs with who has them, oldest first', async () => {
    const { handouts } = (await call('desk', 'GET', `/inventory/allocations?skuId=${sku._id}`)).json;
    expect(handouts.map((h) => [h.recipient.name, h.remainingQty, h.usuallyReplaced])).toEqual([['Chair 3', 2, true]]);
  });
});

describe('Write-offs, waste and approvals (AC16, AC18)', () => {
  let sku;
  beforeAll(async () => {
    sku = await addProduct('Mask', { openingQty: 10, cost: 50000 }); // ₹500 each
  });

  it('AC16: waste is kept apart from normal use', async () => {
    const handout = await issued(sku);
    await finish(handout);
    const res = await call('business', 'POST', '/inventory/movements/write-offs', { body: { skuId: sku._id, locationId: store._id, qty: 2, reason: 'DAMAGE' } });
    expect(res.json.status).toBe('POSTED');
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(-1);
    expect(await bucketTotal(sku, 'WASTED')).toBe(-2);
    expect(await totals(sku)).toMatchObject({ inStore: 7, inUse: 0 });
  });

  it('a lost bottle in use is written off as LOSS, not finished', async () => {
    const handout = await issued(sku);
    const res = await call('business', 'POST', '/inventory/movements/write-offs', { body: { skuId: sku._id, allocationId: handout._id, qty: 1, reason: 'LOSS', note: 'Not found' } });
    expect(res.json.status).toBe('POSTED');
    expect((await InventoryTransaction.findById(res.json.transactionId).lean()).heldBy.name).toBe('Rahul');
    expect((await InventoryAllocation.findById(handout._id).lean()).status).toBe('CLOSED');
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(-1);
    expect(await totals(sku)).toMatchObject({ inStore: 6, inUse: 0 });
  });

  it('an inventory login writes off within the branch limit straight away', async () => {
    const res = await call('inventory', 'POST', '/inventory/movements/write-offs', { body: { skuId: sku._id, locationId: store._id, qty: 1, reason: 'EXPIRY' } });
    expect(res.json.status).toBe('POSTED'); // ₹500 is within ₹2,000
  });

  let requestId;
  it('above the limit it needs a note and waits for an owner; stock is untouched', async () => {
    const body = { skuId: sku._id, locationId: store._id, qty: 5, reason: 'DAMAGE' }; // ₹2,500
    expect((await call('inventory', 'POST', '/inventory/movements/write-offs', { body })).json.error.code).toBe('NOTE_REQUIRED');
    const res = await call('inventory', 'POST', '/inventory/movements/write-offs', { body: { ...body, note: 'Shelf fell' } });
    expect(res.json.status).toBe('PENDING_APPROVAL');
    requestId = res.json.approval._id;
    expect(await totals(sku)).toMatchObject({ inStore: 5 });
    expect(await Notification.exists({ userId: users.business._id, message: /Suresh asks to approve/ })).toBeTruthy();
  });

  it("only an owner who covers that amount at that branch decides; the requester can't", async () => {
    expect((await call('bandraOwner', 'POST', `/inventory/requests/${requestId}/decide`, { body: { approve: true } })).status).toBe(404);
    expect((await call('inventory', 'POST', `/inventory/requests/${requestId}/decide`, { body: { approve: true } })).status).toBe(403);
    const requests = (await call('business', 'GET', '/inventory/requests')).json.requests;
    expect(requests.find((r) => r._id === requestId).canDecide).toBe(true);
  });

  it('approving posts it, as reported by the requester and approved by the owner', async () => {
    const res = await call('business', 'POST', `/inventory/requests/${requestId}/decide`, { body: { approve: true } });
    expect(res.json.status).toBe('APPROVED');
    expect(await totals(sku)).toMatchObject({ inStore: 0 });
    const posted = await InventoryTransaction.findOne({ type: 'WRITE_OFF', 'approvedBy.name': 'Anita' }).lean();
    expect(posted).toMatchObject({ actorName: 'Suresh', reason: 'DAMAGE' });
    expect((await call('business', 'POST', `/inventory/requests/${requestId}/decide`, { body: { approve: true } })).json.error.code).toBe('ALREADY_DECIDED');
    expect(await Notification.exists({ userId: users.inventory._id, message: /Anita approved your request/ })).toBeTruthy();
  });

  it("a product without a known cost always needs approval from an inventory login", async () => {
    const noCost = await addProduct('Foils', { cost: null });
    const res = await call('inventory', 'POST', '/inventory/movements/write-offs', { body: { skuId: noCost._id, locationId: store._id, qty: 1, reason: 'DAMAGE', note: 'Torn' } });
    expect(res.json.status).toBe('PENDING_APPROVAL');
    const rejected = await call('business', 'POST', `/inventory/requests/${res.json.approval._id}/decide`, { body: { approve: false, note: 'Still usable' } });
    expect(rejected.json.status).toBe('REJECTED');
    expect(await totals(noCost)).toMatchObject({ inStore: 10 });
  });

  it('a count correction can add stock that turned up; other reasons only remove', async () => {
    const add = { skuId: sku._id, locationId: store._id, qty: 2, reason: 'STOCK_COUNT_CORRECTION', direction: 'ADD' };
    expect((await call('business', 'POST', '/inventory/movements/write-offs', { body: add })).json.status).toBe('POSTED');
    expect(await totals(sku)).toMatchObject({ inStore: 2 });
    expect((await call('business', 'POST', '/inventory/movements/write-offs', { body: { ...add, reason: 'DAMAGE' } })).status).toBe(400);
  });
});

describe('Front desk (AC18) and their switches', () => {
  let sku;
  beforeAll(async () => {
    sku = await addProduct('Desk shampoo');
  });

  it("AC18: can't write off or see costs, but can report a problem", async () => {
    const writeOff = await call('desk', 'POST', '/inventory/movements/write-offs', { body: { skuId: sku._id, locationId: store._id, qty: 1, reason: 'DAMAGE' } });
    expect(writeOff.status).toBe(403);
    const overview = (await call('desk', 'GET', '/inventory/overview')).json;
    expect(overview.totals).not.toHaveProperty('stockValue');
    expect((await call('business', 'GET', '/inventory/overview')).json.totals.stockValue).toBeGreaterThan(0);

    const report = await call('desk', 'POST', '/inventory/requests/reports', { body: { skuId: sku._id, locationId: store._id, reason: 'DAMAGE', qty: 1, note: 'Cracked bottle' } });
    expect(report.status).toBe(201);
    expect(await Notification.exists({ userId: users.inventory._id, message: /Kavya reported a problem: 1 bottle of Desk shampoo \(damaged\)/ })).toBeTruthy();
  });

  it('the inventory login writes off the reported bottle, which closes the report', async () => {
    const { requests } = (await call('inventory', 'GET', '/inventory/requests')).json;
    const report = requests.find((r) => r.kind === 'PROBLEM_REPORT');
    expect(report.canDecide).toBe(true);
    const res = await call('inventory', 'POST', '/inventory/movements/write-offs', {
      body: { skuId: sku._id, locationId: store._id, qty: 1, reason: 'DAMAGE', reportId: report._id },
    });
    expect(res.json.status).toBe('POSTED');
    const mine = (await call('desk', 'GET', '/inventory/requests')).json.requests;
    expect(mine[0]).toMatchObject({ status: 'RESOLVED', decisionNote: 'Written off' });
  });

  it('marks finished by default, but needs a switch to issue', async () => {
    const handout = await issued(sku);
    expect((await finish(handout, { qty: 1 }, { who: 'desk' })).status).toBe(200);
    expect((await issue(sku, { who: 'desk' })).status).toBe(403);

    await InventorySettings.updateOne({ branchId: f.andheri._id }, { $set: { orgId: f.ctxGlamour.orgId, 'frontDesk.issue': true, 'frontDesk.finish': false } }, { upsert: true });
    const deskHandout = await issued(sku, { who: 'desk' });
    expect((await finish(deskHandout, { qty: 1 }, { who: 'desk' })).status).toBe(403);
    await InventorySettings.deleteMany({ branchId: f.andheri._id }); // back to the defaults
  });
});

describe('Low stock (AC17)', () => {
  it('uses what is available in the store, not the total with stock in use, and alerts once', async () => {
    const sku = await addProduct('Toner', { openingQty: 8, reorderPoint: 2 });
    await issued(sku, { qty: 5 }); // store 3, in use 5: total 8 is far above 2, but that doesn't count
    expect((await totals(sku)).needToOrder).toBe(false);
    const handout = await issued(sku); // store 2
    expect((await totals(sku)).needToOrder).toBe(true);
    await issued(sku); // store 1
    expect(await Notification.countDocuments({ userId: users.inventory._id, message: /Low stock: Toner/ })).toBe(1);

    // Restocked (a return), then low again: a new alert
    await call('business', 'POST', `/inventory/allocations/${handout._id}/return`, { body: { qty: 1 } });
    const back = await call('business', 'POST', '/inventory/movements/write-offs', { body: { skuId: sku._id, locationId: store._id, qty: 5, reason: 'STOCK_COUNT_CORRECTION', direction: 'ADD' } });
    expect(back.json.totals.inStore).toBe(7);
    await issued(sku, { qty: 5 });
    expect(await Notification.countDocuments({ userId: users.inventory._id, message: /Low stock: Toner/ })).toBe(2);
  });
});

describe('Fixing a mistaken finish', () => {
  it('an owner undoes it with a correction that points at it; nothing is deleted', async () => {
    const sku = await addProduct('Oil');
    const handout = await issued(sku);
    await finish(handout);
    const original = await InventoryTransaction.findOne({ type: 'FINISH', 'reference.id': handout._id }).lean();

    expect((await call('inventory', 'POST', `/inventory/movements/${original._id}/correct`, { body: { note: 'Wrong bottle' } })).status).toBe(403);
    const res = await call('business', 'POST', `/inventory/movements/${original._id}/correct`, { body: { note: 'Wrong bottle' } });
    expect(res.json.allocation).toMatchObject({ status: 'OPEN', remainingQty: 1 });
    expect(await totals(sku)).toMatchObject({ inStore: 9, inUse: 1 });
    expect(await bucketTotal(sku, 'CONSUMED')).toBe(0);
    expect(await InventoryTransaction.exists({ _id: original._id })).toBeTruthy();
    expect((await call('business', 'POST', `/inventory/movements/${original._id}/correct`, { body: { note: 'Again' } })).json.error.code).toBe('ALREADY_CORRECTED');
  });
});

describe('Staff leaving (AC26)', () => {
  it('flags their open hand-outs for handover and tells the owners; moving it settles it', async () => {
    const sku = await addProduct('Neha’s shampoo');
    const handout = await issued(sku, { recipient: { kind: 'STAFF', id: String(f.neha._id) } });
    const res = await call('business', 'PATCH', `/staff/${f.neha._id}/status`, { body: { status: 'inactive', confirm: true } });
    expect(res.status).toBe(200);

    expect((await InventoryAllocation.findById(handout._id).lean()).needsHandover).toBe(true);
    expect(await Notification.exists({ userId: users.inventory._id, message: /Neha still has 1 bottle of Neha’s shampoo/ })).toBeTruthy();
    const overview = (await call('business', 'GET', '/inventory/overview')).json;
    expect(overview.handover.map((h) => h.recipient.name)).toEqual(['Neha']);

    await call('business', 'POST', `/inventory/allocations/${handout._id}/move`, { body: { recipient: { kind: 'STAFF', id: String(f.rahul._id) } } });
    expect((await call('business', 'GET', '/inventory/overview')).json.handover).toEqual([]);
  });
});

describe('Overview and isolation', () => {
  it('shows totals, what needs ordering and recent activity; the front desk sees only their own actions', async () => {
    const overview = (await call('business', 'GET', '/inventory/overview')).json;
    expect(overview.totals.products).toBeGreaterThan(5);
    expect(overview.needToOrder.some((n) => n.sku.name === 'Toner')).toBe(true);
    expect(overview.recent.length).toBeGreaterThan(0);
    const desk = (await call('desk', 'GET', '/inventory/overview')).json;
    expect(desk.recent.every((r) => r.actorName === 'Kavya')).toBe(true);
  });

  it("another salon can't touch these hand-outs or requests", async () => {
    const handout = await InventoryAllocation.findOne({ status: 'OPEN' }).lean();
    expect((await call('desert', 'POST', `/inventory/allocations/${handout._id}/finish`, { body: { qty: 1 } })).status).toBe(404);
    expect((await call('desert', 'POST', `/inventory/allocations/${handout._id}/move`, { body: { recipient: { kind: 'FLOOR' } } })).status).toBe(404);
    expect((await call('desert', 'GET', '/inventory/requests')).json.requests).toEqual([]);
  });

  it('AC24: after all of this, every balance matches the movement history', async () => {
    expect(await reconcile(f.ctxGlamour)).toEqual([]);
  });
});
