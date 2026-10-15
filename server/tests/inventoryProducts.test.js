// Inventory add-on, Phase 2: products, stores and stations, and the stock engine.
// PRD tests covered here: AC01 (opening stock), AC20 (another salon's ids), AC24 (balances match the history).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import {
  InventoryAllocation,
  InventoryBalance,
  InventoryLocation,
  InventorySku,
  InventoryTransaction,
  Notification,
  Organization,
  User,
} from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { postMovement, reconcile } from '../src/modules/inventory/stock/stock.engine.js';
import { describeQty } from '../src/modules/inventory/units.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';

let server;
let api;
let f;
let owner; // ctx of the business owner, for calling the stock engine directly
const cookies = {};
const users = {};

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!res.ok) throw new Error(`Login failed for ${email}: ${res.status}`);
  return res.headers.get('set-cookie').split(';')[0];
}

const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

// Changes get a fresh Idempotency-Key unless one is given (key: null sends none)
async function call(who, method, path, { body, branch, key = method === 'GET' ? null : newKey() } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who] };
  if (branch) headers['x-branch-id'] = String(branch);
  if (key) headers['idempotency-key'] = key;
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const shampoo = { name: 'Loreal Shampoo 1L', category: 'Hair care', stockUnit: 'bottle', wayOfUse: 'FINISH' };

async function addProduct(who, body, options) {
  const res = await call(who, 'POST', '/inventory/skus', { body, ...options });
  if (res.status !== 201) throw new Error(`Add product failed: ${res.status} ${JSON.stringify(res.json)}`);
  return res.json.sku;
}

const product = async (who, id, options) => (await call(who, 'GET', `/inventory/skus/${id}`, options)).json;

async function inTransaction(work) {
  return mongoose.connection.transaction((session) => work(session));
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  await Organization.updateMany({}, { $set: { 'addons.inventory.enabled': true } }); // both salons have the add-on

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
  owner = { ...f.ctxGlamour, userId: String(users.business._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true, addons: ['inventory'] };

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const who of Object.keys(users)) cookies[who] = await login(users[who].email);
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('Stores and stations', () => {
  it('every branch gets Main store and In use automatically', async () => {
    const res = await call('inventory', 'GET', '/inventory/locations');
    expect(res.status).toBe(200);
    expect(res.json.locations.map((l) => [l.name, l.kind])).toEqual([
      ['Main store', 'STORE'],
      ['In use', 'IN_USE'],
    ]);
    // Asking again doesn't make more
    await call('business', 'GET', '/inventory/locations');
    expect(await InventoryLocation.countDocuments({ branchId: f.andheri._id })).toBe(2);
  });

  it('owners add stores and stations; names are unique per branch', async () => {
    const station = await call('business', 'POST', '/inventory/locations', { body: { kind: 'STATION', name: 'Chair 3' } });
    expect(station.status).toBe(201);
    expect((await call('business', 'POST', '/inventory/locations', { body: { kind: 'STORE', name: 'Back room' } })).status).toBe(201);
    expect((await call('business', 'POST', '/inventory/locations', { body: { kind: 'STORE', name: 'chair 3' } })).json.error.code).toBe('NAME_TAKEN');
    // The same name at another branch is fine
    expect((await call('business', 'POST', '/inventory/locations', { body: { kind: 'STATION', name: 'Chair 3' }, branch: f.bandra._id })).status).toBe(201);
  });

  it("inventory logins and the front desk can't change them", async () => {
    for (const who of ['inventory', 'desk']) {
      expect((await call(who, 'POST', '/inventory/locations', { body: { kind: 'STATION', name: 'Mine' } })).status).toBe(403);
    }
  });

  it("Main store and In use can't be closed", async () => {
    const { locations } = (await call('business', 'GET', '/inventory/locations')).json;
    const main = locations.find((l) => l.isMain);
    expect((await call('business', 'PATCH', `/inventory/locations/${main._id}`, { body: { active: false } })).json.error.code).toBe('LOCATION_REQUIRED');
    expect((await call('business', 'PATCH', `/inventory/locations/${main._id}`, { body: { name: 'Front shelf' } })).json.location.name).toBe('Front shelf');
    await call('business', 'PATCH', `/inventory/locations/${main._id}`, { body: { name: 'Main store' } });
  });
});

describe('Adding a product', () => {
  let sku;

  it('AC01: an opening of 10 bottles puts 10 in the store, as a movement', async () => {
    sku = await addProduct('business', { ...shampoo, openingQty: 10, openingUnitCost: 50000 });
    expect(sku.code).toBe('SKU-000001');

    const page = await product('business', sku._id);
    expect(page.totals).toMatchObject({ inStore: 10, inUse: 0, available: 10 });
    expect(page.balances.find((b) => b.isMain).qty).toBe(10);
    expect(page.branch.avgCost).toBe(50000);
    expect(page.branch.value).toBe(500000);

    const history = (await call('business', 'GET', `/inventory/skus/${sku._id}/movements`)).json;
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ type: 'OPENING', qty: 10, unitCost: 50000, actorName: 'Anita', actorRole: 'Business owner' });
  });

  it('sending the same request twice adds it only once', async () => {
    const key = newKey();
    const body = { ...shampoo, name: 'Wax jar', stockUnit: 'jar', openingQty: 5 };
    const first = await call('business', 'POST', '/inventory/skus', { body, key });
    const again = await call('business', 'POST', '/inventory/skus', { body, key });
    expect(again.json.sku._id).toBe(first.json.sku._id);
    expect(await InventorySku.countDocuments({ name: 'Wax jar' })).toBe(1);
    expect((await product('business', first.json.sku._id)).totals.inStore).toBe(5);
  });

  it('needs an Idempotency-Key, and a key is only for one kind of change', async () => {
    expect((await call('business', 'POST', '/inventory/skus', { body: shampoo, key: null })).status).toBe(400);
    const key = newKey();
    await call('business', 'POST', '/inventory/skus', { body: { ...shampoo, name: 'Gloves' }, key });
    const reused = await call('business', 'POST', '/inventory/locations', { body: { kind: 'STATION', name: 'Chair 9' }, key });
    expect(reused.json.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('counts measured products in whole ml: 3 bottles + 400 ml = 3400 ml', async () => {
    const developer = await addProduct('business', {
      name: 'Developer 6%',
      category: 'Colour',
      stockUnit: 'bottle',
      wayOfUse: 'SERVICE_MEASURED',
      baseUnit: 'ml',
      unitsPerStockUnit: 1000,
      openingQty: 3400,
    });
    expect((await product('business', developer._id)).totals.inStore).toBe(3400);
    expect(describeQty(3400, developer)).toBe('3 bottles + 400 ml');
  });

  it('refuses a measured product without its measure, and part units', async () => {
    const noMeasure = await call('business', 'POST', '/inventory/skus', { body: { ...shampoo, wayOfUse: 'SERVICE_MEASURED' } });
    expect(noMeasure.status).toBe(400);
    const half = await call('business', 'POST', '/inventory/skus', { body: { ...shampoo, openingQty: 2.5 } });
    expect(half.status).toBe(400);
  });

  it('makes codes automatically and keeps codes and barcodes unique in the salon', async () => {
    const own = await addProduct('business', { ...shampoo, name: 'Own code', code: 'sku-000009' });
    expect(own.code).toBe('SKU-000009');
    const next = await addProduct('business', { ...shampoo, name: 'Next', barcodes: ['8901234567890'] });
    expect(next.code).toMatch(/^SKU-0000(0[5-8])$/);

    expect((await call('business', 'POST', '/inventory/skus', { body: { ...shampoo, code: 'SKU-000009' } })).json.error.code).toBe('CODE_TAKEN');
    const sameBarcode = await call('business', 'POST', '/inventory/skus', { body: { ...shampoo, barcodes: ['8901234567890'] } });
    expect(sameBarcode.json.error.code).toBe('BARCODE_TAKEN');
    expect(sameBarcode.json.error.details.name).toBe('Next');
    // Another salon may use the same barcode and code
    expect((await call('desert', 'POST', '/inventory/skus', { body: { ...shampoo, code: 'SKU-000009', barcodes: ['8901234567890'] } })).status).toBe(201);
  });

  it('a scanned barcode finds the product straight away', async () => {
    const res = await call('business', 'GET', '/inventory/skus?search=8901234567890');
    expect(res.json.rows).toHaveLength(1);
    expect(res.json.exactMatchId).toBe(res.json.rows[0]._id);
  });
});

describe('Who sees costs and who adds products', () => {
  it('owners see costs; inventory logins and the front desk never get them', async () => {
    const ownerRows = (await call('business', 'GET', '/inventory/skus')).json.rows;
    expect(ownerRows.find((r) => r.code === 'SKU-000001').value).toBe(500000);
    for (const who of ['inventory', 'desk']) {
      const res = await call(who, 'GET', '/inventory/skus');
      expect(res.status).toBe(200);
      const row = res.json.rows.find((r) => r.code === 'SKU-000001');
      expect(row.inStore).toBe(10);
      expect(row).not.toHaveProperty('avgCost');
      expect(row).not.toHaveProperty('value');
      const page = await product(who, row._id);
      expect(page.branch).not.toHaveProperty('avgCost');
      const history = (await call(who, 'GET', `/inventory/skus/${row._id}/movements`)).json;
      expect(history.items[0]).not.toHaveProperty('unitCost');
    }
  });

  it('an inventory login adds products for their branch, but not with a cost', async () => {
    expect((await call('inventory', 'POST', '/inventory/skus', { body: { ...shampoo, name: 'Foils', openingQty: 2, openingUnitCost: 100 } })).status).toBe(403);
    const foils = await addProduct('inventory', { ...shampoo, name: 'Foils', stockUnit: 'box', wayOfUse: 'MANUAL', openingQty: 2 });
    expect((await product('inventory', foils._id)).totals.inStore).toBe(2);

    // Logged, and the business owner hears about it
    const bell = await Notification.findOne({ userId: users.business._id, message: /Suresh \(Inventory\): Added the product Foils/ });
    expect(bell).toBeTruthy();
  });

  it("the front desk can't add or change products", async () => {
    expect((await call('desk', 'POST', '/inventory/skus', { body: shampoo })).status).toBe(403);
  });
});

describe('Editing a product', () => {
  let sku;
  beforeAll(async () => {
    sku = await addProduct('business', { ...shampoo, name: 'Conditioner', openingQty: 4 });
  });

  it('refuses a stale edit (STALE_VERSION)', async () => {
    const first = await call('business', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: 1, brand: 'Loreal', reorderPoint: 2 } });
    expect(first.status).toBe(200);
    expect(first.json.sku.version).toBe(2);
    const stale = await call('inventory', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: 1, name: 'Old screen' } });
    expect(stale.json.error.code).toBe('STALE_VERSION');
  });

  it('shows Need to order when available stock is at or below the reorder point', async () => {
    await call('business', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: 2, reorderPoint: 4, reorderQty: 6 } });
    const rows = (await call('business', 'GET', '/inventory/skus?needToOrder=true')).json.rows;
    expect(rows.map((r) => r.name)).toEqual(['Conditioner']);
  });

  it('a branch owner edits only products used nowhere but their branches', async () => {
    // Bandra's owner can see the salon's product, but it's used at Andheri
    const page = await product('bandraOwner', sku._id, { branch: f.bandra._id });
    expect(page.usedHere).toBe(false);
    expect(page.canEdit).toBe(false);
    expect((await call('bandraOwner', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: 3, name: 'Mine now' } })).status).toBe(403);
    expect((await call('bandraOwner', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: 3, reorderPoint: 1 } })).json.error.code).toBe('NOT_USED_HERE');

    // They start using it at Bandra and set Bandra's own reorder level
    expect((await call('bandraOwner', 'POST', `/inventory/skus/${sku._id}/use-here`)).status).toBe(200);
    expect((await call('bandraOwner', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: 3, reorderPoint: 1 } })).status).toBe(200);
    expect((await product('business', sku._id)).branch.reorderPoint).toBe(4); // Andheri's level unchanged
  });

  it('an inventory login can no longer edit it once another branch uses it', async () => {
    const page = await product('inventory', sku._id);
    expect(page.canEdit).toBe(false);
    expect((await call('inventory', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: page.sku.version, name: 'Renamed' } })).status).toBe(403);
    // Reorder levels for their own branch are still theirs to set
    expect((await call('inventory', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: page.sku.version, reorderPoint: 3 } })).status).toBe(200);
  });

  it("blocks changing the way of use while hand-outs are open", async () => {
    const { sku: current } = await product('business', sku._id);
    await InventoryAllocation.create({ orgId: owner.orgId, branchId: f.andheri._id, skuId: sku._id, recipient: { kind: 'FLOOR', name: 'Floor' }, issuedQty: 1, remainingQty: 1 });
    const res = await call('business', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: current.version, wayOfUse: 'MANUAL' } });
    expect(res.json.error.code).toBe('MODE_CHANGE_BLOCKED');
    await InventoryAllocation.deleteMany({ skuId: sku._id });
    expect((await call('business', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: current.version, wayOfUse: 'MANUAL' } })).status).toBe(200);
  });

  it("can't change how a product is counted once it has stock history", async () => {
    const { sku: current } = await product('business', sku._id);
    const res = await call('business', 'PATCH', `/inventory/skus/${sku._id}`, {
      body: { version: current.version, wayOfUse: 'SERVICE_MEASURED', baseUnit: 'ml', unitsPerStockUnit: 500 },
    });
    expect(res.json.error.code).toBe('COUNTING_CHANGE_BLOCKED');
    // A product with no history yet can
    const fresh = await addProduct('business', { ...shampoo, name: 'Hair colour 60 ml' });
    const ok = await call('business', 'PATCH', `/inventory/skus/${fresh._id}`, { body: { version: 1, wayOfUse: 'SERVICE_MEASURED', baseUnit: 'ml', unitsPerStockUnit: 60 } });
    expect(ok.json.sku).toMatchObject({ baseUnit: 'ml', unitsPerStockUnit: 60 });
  });

  it('deactivating keeps all its history', async () => {
    const { sku: current } = await product('business', sku._id);
    expect((await call('business', 'PATCH', `/inventory/skus/${sku._id}/status`, { body: { version: current.version, status: 'inactive' } })).status).toBe(200);
    expect((await call('business', 'GET', '/inventory/skus')).json.rows.some((r) => r.name === 'Conditioner')).toBe(false);
    expect((await call('business', 'GET', '/inventory/skus?status=inactive')).json.rows.map((r) => r.name)).toEqual(['Conditioner']);
    expect((await call('business', 'GET', `/inventory/skus/${sku._id}/movements`)).json.items).toHaveLength(1);
    expect((await product('business', sku._id)).totals.inStore).toBe(4);
  });
});

describe("AC20: another salon's ids are refused", () => {
  let sku;
  let location;
  beforeAll(async () => {
    sku = await InventorySku.findOne({ orgId: owner.orgId, code: 'SKU-000001' }).lean();
    location = await InventoryLocation.findOne({ branchId: f.andheri._id, isMain: true }).lean();
  });

  const attempts = [
    ['open the product', () => ['GET', `/inventory/skus/${sku._id}`]],
    ['read its history', () => ['GET', `/inventory/skus/${sku._id}/movements`]],
    ['edit it', () => ['PATCH', `/inventory/skus/${sku._id}`, { body: { version: 1, name: 'Hacked' } }]],
    ['deactivate it', () => ['PATCH', `/inventory/skus/${sku._id}/status`, { body: { version: 1, status: 'inactive' } }]],
    ['use it at their branch', () => ['POST', `/inventory/skus/${sku._id}/use-here`]],
    ['rename the store', () => ['PATCH', `/inventory/locations/${location._id}`, { body: { name: 'Hacked' } }]],
  ];
  for (const [what, request] of attempts) {
    it(`can't ${what}`, async () => {
      const [method, path, options] = request();
      expect((await call('desert', method, path, options)).status).toBe(404);
    });
  }

  it("can't post stock into another salon's store", async () => {
    const desert = { ...f.ctxDesert, userId: String(users.desert._id), userName: 'Layla', role: 'OWNER', isPrimaryOwner: true };
    const attempt = inTransaction((session) =>
      postMovement(desert, { branchId: f.marina._id, type: 'OPENING', lines: [{ skuId: sku._id, locationId: location._id, qty: 5, bucket: 'OPENING' }] }, session)
    );
    await expect(attempt).rejects.toMatchObject({ status: 404 });
  });
});

describe('Stock engine', () => {
  let sku;
  let store;
  let inUse;
  beforeAll(async () => {
    sku = await addProduct('business', { ...shampoo, name: 'Engine shampoo', openingQty: 10, openingUnitCost: 500 });
    store = await InventoryLocation.findOne({ branchId: f.andheri._id, isMain: true }).lean();
    inUse = await InventoryLocation.findOne({ branchId: f.andheri._id, kind: 'IN_USE' }).lean();
  });

  const move = (lines, extra = {}) => inTransaction((session) => postMovement(owner, { branchId: f.andheri._id, type: 'ISSUE', lines, ...extra }, session));
  const qtyAt = async (location) => (await InventoryBalance.findOne({ skuId: sku._id, locationId: location._id }).lean())?.qty ?? 0;

  it('moving stock from store to in use keeps the branch total', async () => {
    await move([
      { skuId: sku._id, locationId: store._id, qty: -3, bucket: 'MOVED' },
      { skuId: sku._id, locationId: inUse._id, qty: 3, bucket: 'MOVED' },
    ]);
    expect([await qtyAt(store), await qtyAt(inUse)]).toEqual([7, 3]);
  });

  it('never goes below zero, and a refused movement leaves nothing behind', async () => {
    const before = await InventoryTransaction.countDocuments();
    await expect(move([{ skuId: sku._id, locationId: store._id, qty: -8, bucket: 'CONSUMED' }], { type: 'WRITE_OFF' })).rejects.toMatchObject({
      code: 'INSUFFICIENT_AVAILABLE_STOCK',
      details: { requested: 8, available: 7 },
    });
    expect(await qtyAt(store)).toBe(7);
    expect(await InventoryTransaction.countDocuments()).toBe(before);
  });

  it('two people taking stock at the same moment can never take more than there is', async () => {
    const attempts = await Promise.allSettled(
      Array.from({ length: 5 }, () => move([{ skuId: sku._id, locationId: store._id, qty: -3, bucket: 'CONSUMED' }], { type: 'WRITE_OFF' }))
    );
    expect(attempts.filter((a) => a.status === 'fulfilled')).toHaveLength(2); // 7 -> 4 -> 1
    expect(await qtyAt(store)).toBe(1);
  });

  it('refuses stations (their stock counts as In use) and part units', async () => {
    const station = await InventoryLocation.findOne({ branchId: f.andheri._id, kind: 'STATION' }).lean();
    await expect(move([{ skuId: sku._id, locationId: station._id, qty: 1, bucket: 'MOVED' }])).rejects.toMatchObject({ status: 400 });
    await expect(move([{ skuId: sku._id, locationId: store._id, qty: 1.5, bucket: 'RECEIVED' }])).rejects.toMatchObject({ status: 400 });
  });

  it('stock arriving at a new price updates the moving average cost', async () => {
    // On hand: 1 in store + 3 in use = 4 at 500. 4 more at 800 -> (4×500 + 4×800) / 8 = 650
    await move([{ skuId: sku._id, locationId: store._id, qty: 4, unitCost: 800, bucket: 'RECEIVED' }], { type: 'RECEIPT' });
    expect((await product('business', sku._id)).branch.avgCost).toBe(650);
    // A delivery without a price doesn't change it (nothing is guessed)
    await move([{ skuId: sku._id, locationId: store._id, qty: 2, bucket: 'RECEIVED' }], { type: 'RECEIPT' });
    expect((await product('business', sku._id)).branch.avgCost).toBe(650);
  });

  it('history rows can never be changed', async () => {
    await expect(InventoryTransaction.updateMany({}, { $set: { note: 'edited' } })).rejects.toThrow(/cannot be changed/);
  });

  it('AC24: after all of the above, every balance matches the movement history', async () => {
    expect(await reconcile(owner)).toEqual([]);
    expect(await reconcile({ orgId: f.ctxDesert.orgId })).toEqual([]);
  });
});

describe('Activity log', () => {
  it('stock changes are logged, and kept out of the payroll activity tab', async () => {
    const stock = (await call('business', 'GET', '/activity?area=inventory')).json.items;
    expect(stock.length).toBeGreaterThan(0);
    expect(stock.every((i) => i.action.startsWith('inventory.'))).toBe(true);
    const pay = (await call('business', 'GET', '/activity?area=payroll')).json.items;
    expect(pay.some((i) => i.action.startsWith('inventory.'))).toBe(false);
  });
});

describe('Editing details', () => {
  it('an empty brand box clears the brand', async () => {
    const sku = await addProduct('business', { ...shampoo, name: 'Branded', brand: 'Matrix' });
    expect(sku.brand).toBe('Matrix');
    const res = await call('business', 'PATCH', `/inventory/skus/${sku._id}`, { body: { version: 1, brand: '' } });
    expect(res.json.sku.brand).toBe('');
  });
});
