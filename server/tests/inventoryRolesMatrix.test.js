// Inventory add-on, Phase 7: every inventory action tried by every role, through the real API
// (like frontDeskAccess.test.js), plus cost visibility in screens and CSV exports (AC27), reports, settings,
// the stock-records check, and the add-on being switched off.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { InventoryTransaction, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';
const ROLES = ['business', 'inventory', 'desk'];

let server;
let api;
let f;
const cookies = {};
const ids = {};

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie')?.split(';')[0];
}

const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

async function call(who, method, path, { body, branch } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who], 'idempotency-key': newKey() };
  if (branch) headers['x-branch-id'] = String(branch);
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  const type = res.headers.get('content-type') ?? '';
  return { status: res.status, type, json: type.includes('json') ? await res.json() : null, text: type.includes('csv') ? await res.text() : null };
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  await Organization.updateOne({ _id: f.ctxGlamour.orgId }, { $set: { 'addons.inventory.enabled': true } });
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'INVENTORY', name: 'Suresh', email: 'suresh@g.com', passwordHash, branchIds: [f.andheri._id] },
  ]);
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', bandraOwner: 'vikram@g.com', desk: 'kavya@g.com', inventory: 'suresh@g.com' })) cookies[who] = await login(email);

  // Andheri data to aim at
  const sku = (await call('business', 'POST', '/inventory/skus', { body: { name: 'Shampoo', category: 'Hair', stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty: 10, openingUnitCost: 50000 } })).json.sku;
  ids.sku = sku._id;
  ids.store = (await call('business', 'GET', '/inventory/locations')).json.locations.find((l) => l.isMain)._id;
  ids.handout = (await call('business', 'POST', '/inventory/allocations', { body: { skuId: ids.sku, locationId: ids.store, recipient: { kind: 'FLOOR' }, qty: 2 } })).json.allocation._id;
  await call('business', 'POST', `/inventory/allocations/${ids.handout}/finish`, { body: { qty: 1 } });
  ids.finish = String((await InventoryTransaction.findOne({ type: 'FINISH' }).lean())._id);
  ids.supplier = (await call('business', 'POST', '/inventory/suppliers', { body: { name: 'Main supplier' } })).json.supplier._id;
  ids.order = (await call('business', 'POST', '/inventory/purchasing/orders', { body: { supplierId: ids.supplier, lines: [{ skuId: ids.sku, qty: 5, unitCost: 50000 }] } })).json.order._id;
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

// [what, () => [method, path, body], { business, inventory, desk }] — expected HTTP status for each role.
// 2xx = allowed. 403 = refused. A 400/404/409 for an allowed role means the request got past the permission
// check and was stopped by a business rule on purpose (so nothing changes), e.g. a stale version or too much.
const BIG = 99999;
const matrix = [
  ['see the overview', () => ['GET', '/inventory/overview'], { business: 200, inventory: 200, desk: 200 }],
  ['see products', () => ['GET', '/inventory/skus'], { business: 200, inventory: 200, desk: 200 }],
  ['open a product', () => ['GET', `/inventory/skus/${ids.sku}`], { business: 200, inventory: 200, desk: 200 }],
  ['add a product', () => ['POST', '/inventory/skus', { name: `New ${newKey()}`, category: 'Hair', stockUnit: 'jar', wayOfUse: 'MANUAL' }], { business: 201, inventory: 201, desk: 403 }],
  ['edit a product (stale version)', () => ['PATCH', `/inventory/skus/${ids.sku}`, { version: 999, name: 'Renamed' }], { business: 409, inventory: 409, desk: 403 }],
  ['add a store', () => ['POST', '/inventory/locations', { kind: 'STORE', name: `Room ${newKey()}` }], { business: 201, inventory: 403, desk: 403 }],
  ['import a spreadsheet', () => ['POST', '/inventory/imports/preview', { rows: [{ name: 'Wax', category: 'Wax', stock_unit: 'jar', way_of_use: 'FINISH' }] }], { business: 201, inventory: 201, desk: 403 }],
  ['issue a product', () => ['POST', '/inventory/allocations', { skuId: ids.sku, locationId: ids.store, recipient: { kind: 'FLOOR' }, qty: 1 }], { business: 201, inventory: 201, desk: 403 }],
  ['finish more than is left', () => ['POST', `/inventory/allocations/${ids.handout}/finish`, { qty: BIG }], { business: 409, inventory: 409, desk: 409 }],
  ['return more than is left', () => ['POST', `/inventory/allocations/${ids.handout}/return`, { qty: BIG }], { business: 409, inventory: 409, desk: 403 }],
  ['move a hand-out', () => ['POST', `/inventory/allocations/${ids.handout}/move`, { recipient: { kind: 'STAFF', id: String(f.rahul._id) }, qty: BIG }], { business: 409, inventory: 409, desk: 403 }],
  ['write off (too much)', () => ['POST', '/inventory/movements/write-offs', { skuId: ids.sku, locationId: ids.store, qty: BIG, reason: 'DAMAGE' }], { business: 409, inventory: 400, desk: 403 }],
  ['report a problem', () => ['POST', '/inventory/requests/reports', { skuId: ids.sku, reason: 'DAMAGE', note: 'Cracked' }], { business: 201, inventory: 201, desk: 201 }],
  ['undo a finish', () => ['POST', `/inventory/movements/${new mongoose.Types.ObjectId()}/correct`, { note: 'Wrong one' }], { business: 404, inventory: 403, desk: 403 }],
  ['see recipes', () => ['GET', '/inventory/recipes'], { business: 200, inventory: 200, desk: 403 }],
  ['change a recipe (unknown service)', () => ['POST', '/inventory/recipes', { serviceId: String(new mongoose.Types.ObjectId()), scope: 'branch', lines: [] }], { business: 404, inventory: 403, desk: 403 }],
  ['see automatic-use exceptions', () => ['GET', '/inventory/automation'], { business: 200, inventory: 200, desk: 403 }],
  ['add a supplier', () => ['POST', '/inventory/suppliers', { name: `Supplier ${newKey()}` }], { business: 201, inventory: 201, desk: 403 }],
  ['create a purchase order', () => ['POST', '/inventory/purchasing/orders', { supplierId: ids.supplier, lines: [{ skuId: ids.sku, qty: 1 }] }], { business: 201, inventory: 201, desk: 403 }],
  ['see reorder suggestions', () => ['GET', '/inventory/purchasing/suggestions'], { business: 200, inventory: 200, desk: 403 }],
  ['receive without an order', () => ['POST', '/inventory/purchasing/receipts', { lines: [{ skuId: ids.sku, qty: 1 }] }], { business: 201, inventory: 201, desk: 403 }],
  ['receive an order not yet approved', () => ['POST', `/inventory/purchasing/orders/${ids.order}/receive`, { lines: [{ lineId: String(new mongoose.Types.ObjectId()), qty: 1 }] }], { business: 409, inventory: 409, desk: 403 }],
  ['return too much to a supplier', () => ['POST', '/inventory/purchasing/returns', { supplierId: ids.supplier, reason: 'Leaking', lines: [{ skuId: ids.sku, qty: BIG }] }], { business: 409, inventory: 409, desk: 403 }],
  ['see stock counts', () => ['GET', '/inventory/stock-counts'], { business: 200, inventory: 200, desk: 403 }],
  ['run the stock summary report', () => ['GET', '/inventory/reports/stock-summary'], { business: 200, inventory: 200, desk: 403 }],
  ['run the stock value report', () => ['GET', '/inventory/reports/stock-value'], { business: 200, inventory: 403, desk: 403 }],
  ['see inventory settings', () => ['GET', '/inventory/settings'], { business: 200, inventory: 403, desk: 403 }],
  ['change inventory settings', () => ['PATCH', '/inventory/settings', { frontDesk: { finish: true } }], { business: 200, inventory: 403, desk: 403 }],
  ['check the stock records', () => ['GET', '/inventory/settings/check'], { business: 200, inventory: 403, desk: 403 }],
];

for (const role of ROLES) {
  describe(`${role === 'business' ? 'Business owner' : role === 'inventory' ? 'Inventory login' : 'Front desk'} (Andheri)`, () => {
    for (const [what, request, expected] of matrix) {
      it(`${expected[role] < 400 ? 'can' : 'is stopped from'}: ${what} (${expected[role]})`, async () => {
        const [method, path, body] = request();
        const res = await call(role, method, path, { body });
        expect(res.status, JSON.stringify(res.json)).toBe(expected[role]);
      });
    }
  });
}

describe('Branch owner of another branch (Bandra)', () => {
  it('is refused at Andheri for every inventory action', async () => {
    for (const [what, request] of matrix) {
      const [method, path, body] = request();
      expect((await call('bandraOwner', method, path, { body, branch: f.andheri._id })).status, what).toBe(403);
    }
  });

  it("can't reach Andheri's records from Bandra either", async () => {
    expect((await call('bandraOwner', 'POST', `/inventory/allocations/${ids.handout}/finish`, { body: { qty: 1 } })).status).toBe(404);
    expect((await call('bandraOwner', 'GET', `/inventory/purchasing/orders/${ids.order}`)).status).toBe(404);
    expect((await call('bandraOwner', 'POST', `/inventory/movements/${ids.finish}/correct`, { body: { note: 'Not mine' } })).status).toBe(404);
  });
});

describe('Costs (AC18, AC27)', () => {
  it('only owners get cost columns, on screen and in CSV exports', async () => {
    const owner = await call('business', 'GET', '/inventory/reports/stock-summary');
    expect(owner.json.columns.map((c) => c.key)).toContain('value');
    expect(owner.json.rows.find((r) => r.product === 'Shampoo').value).toBeGreaterThan(0);
    const ownerCsv = await call('business', 'GET', '/inventory/reports/stock-summary?format=csv');
    expect(ownerCsv.type).toContain('text/csv');
    expect(ownerCsv.text.split('\n')[0]).toContain('Value (₹)');

    const store = await call('inventory', 'GET', '/inventory/reports/stock-summary');
    expect(store.json.columns.map((c) => c.key)).not.toContain('value');
    expect(store.json.rows.find((r) => r.product === 'Shampoo')).not.toHaveProperty('value');
    const storeCsv = await call('inventory', 'GET', '/inventory/reports/stock-summary?format=csv');
    expect(storeCsv.text).not.toContain('Value');
    expect((await call('inventory', 'GET', '/inventory/reports/price-changes?format=csv')).status).toBe(403);

    expect((await call('desk', 'GET', '/inventory/overview')).json.totals).not.toHaveProperty('stockValue');
  });

  it('a branch owner sees costs unless the business owner turns that off', async () => {
    const vikram = async () => (await call('bandraOwner', 'GET', '/inventory/access')).json.can['inventory.viewCosts'];
    expect(await vikram()).toBe(true);
    // A branch owner can't change that (or their own limits) themselves
    expect((await call('bandraOwner', 'PATCH', '/inventory/settings', { body: { branchOwnerSeesCosts: true } })).status).toBe(403);
    expect((await call('bandraOwner', 'PATCH', '/inventory/settings', { body: { limits: { branchOwnerWriteOff: 99999999 } } })).status).toBe(403);
    expect((await call('bandraOwner', 'PATCH', '/inventory/settings', { body: { frontDesk: { issue: true } } })).status).toBe(200);
    expect((await call('business', 'PATCH', '/inventory/settings', { body: { branchOwnerSeesCosts: false }, branch: f.bandra._id })).status).toBe(200);
    expect(await vikram()).toBe(false);
  });
});

describe('Reports and settings', () => {
  it('every report runs for the business owner, for one branch or all of them', async () => {
    for (const name of ['stock-summary', 'low-stock', 'use-by-product', 'recipient-use', 'service-use', 'waste', 'purchasing', 'price-changes', 'stock-value', 'bottle-efficiency']) {
      const res = await call('business', 'GET', `/inventory/reports/${name}?branches=all`);
      expect(res.status, name).toBe(200);
      expect(res.json.branches.sort()).toEqual(['Andheri', 'Bandra']);
    }
    const use = (await call('business', 'GET', '/inventory/reports/recipient-use')).json;
    expect(use.rows[0]).toMatchObject({ who: 'Salon floor', product: 'Shampoo', qty: 1 });
  });

  it('front desk switches change what the front desk may do', async () => {
    expect((await call('business', 'PATCH', '/inventory/settings', { body: { frontDesk: { issue: true } } })).json.frontDesk.issue).toBe(true);
    expect((await call('desk', 'GET', '/inventory/access')).json.can['inventory.issue']).toBe(true);
    await call('business', 'PATCH', '/inventory/settings', { body: { frontDesk: { issue: false } } });
    expect((await call('desk', 'GET', '/inventory/access')).json.can['inventory.issue']).toBe(false);
  });

  it('the stock-records check finds nothing wrong', async () => {
    const res = await call('business', 'GET', '/inventory/settings/check');
    expect(res.json).toMatchObject({ ok: true, mismatches: [] });
  });
});

describe('Add-on switched off', () => {
  it('closes every inventory action for everyone', async () => {
    await Organization.updateOne({ _id: f.ctxGlamour.orgId }, { $set: { 'addons.inventory.enabled': false } });
    for (const [what, request] of matrix) {
      const [method, path, body] = request();
      const res = await call('business', method, path, { body });
      expect(res.status, what).toBe(403);
      expect(res.json.error.code).toBe('ADDON_DISABLED');
      expect((await call('desk', method, path, { body })).status, what).toBe(403);
      expect((await call('inventory', method, path, { body })).status, what).toBe(401); // logged out
    }
  });
});
