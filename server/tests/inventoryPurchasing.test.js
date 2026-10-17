// Inventory add-on, Phase 6: suppliers, purchase orders, receiving, returns and stock counts.
// PRD tests: AC21 (part receipt), AC22 (count posts movements), AC30 (suggestions count approved orders),
// plus approval limits and the over-receipt rule.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { InventoryAllocation, InventoryLedgerEntry, InventorySettings, InventoryTransaction, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { reconcile } from '../src/modules/inventory/stock/stock.engine.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';

let server;
let api;
let f;
let supplier;
let store;
const cookies = {};
const users = {};
const sku = {};

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

const P = '/inventory/purchasing';
const product = async (s, who = 'business') => (await call(who, 'GET', `/inventory/skus/${s._id}`)).json;
const inStore = async (s) => (await product(s)).totals.inStore;

async function order(who, lines, extra = {}) {
  const res = await call(who, 'POST', `${P}/orders`, { body: { supplierId: supplier._id, lines, ...extra } });
  if (res.status !== 201) throw new Error(JSON.stringify(res.json));
  return res.json.order;
}
const act = (who, po, step, body = {}) => call(who, 'POST', `${P}/orders/${po._id}/${step}`, { body });

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  await Organization.updateMany({}, { $set: { 'addons.inventory.enabled': true } });
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const created = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Meera', email: 'meera@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'INVENTORY', name: 'Suresh', email: 'suresh@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Layla', email: 'layla@d.com', passwordHash, allBranches: true },
  ]);
  ['business', 'andheriOwner', 'desk', 'inventory', 'desert'].forEach((who, i) => (users[who] = created[i]));
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const who of Object.keys(users)) cookies[who] = await login(users[who].email);

  const add = async (body) => (await call('business', 'POST', '/inventory/skus', { body: { category: 'Hair', stockUnit: 'bottle', ...body } })).json.sku;
  sku.shampoo = await add({ name: 'Shampoo', wayOfUse: 'FINISH', openingQty: 2, openingUnitCost: 50000, reorderPoint: 5, reorderQty: 10 });
  sku.developer = await add({ name: 'Developer', wayOfUse: 'SERVICE_MEASURED', baseUnit: 'ml', unitsPerStockUnit: 1000, openingQty: 500, reorderPoint: 1000 });
  sku.mask = await add({ name: 'Mask', wayOfUse: 'FINISH', openingQty: 1, reorderPoint: 3 });
  store = (await call('business', 'GET', '/inventory/locations')).json.locations.find((l) => l.isMain);
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('Suppliers', () => {
  it('owners and inventory logins add suppliers; names are unique; the front desk can’t', async () => {
    const res = await call('inventory', 'POST', '/inventory/suppliers', { body: { name: 'Beauty Distributors', phone: '9811111111', paymentTerms: '30 days', leadTimeDays: 3 } });
    expect(res.status).toBe(201);
    supplier = res.json.supplier;
    expect((await call('business', 'POST', '/inventory/suppliers', { body: { name: 'beauty distributors' } })).json.error.code).toBe('NAME_TAKEN');
    expect((await call('desk', 'POST', '/inventory/suppliers', { body: { name: 'Mine' } })).status).toBe(403);
  });

  it('a product remembers its usual supplier at this branch', async () => {
    for (const s of [sku.shampoo, sku.developer]) {
      const { sku: current } = await product(s);
      expect((await call('business', 'PATCH', `/inventory/skus/${s._id}`, { body: { version: current.version, preferredSupplierId: supplier._id } })).status).toBe(200);
    }
    expect((await product(sku.shampoo)).branch.preferredSupplierId).toBe(supplier._id);
    const rows = (await call('business', 'GET', `/inventory/skus?supplierId=${supplier._id}`)).json.rows;
    expect(rows.map((r) => r.name).sort()).toEqual(['Developer', 'Shampoo']);
  });
});

describe('Reorder suggestions (AC30)', () => {
  const suggested = async () => Object.fromEntries((await call('inventory', 'GET', `${P}/suggestions`)).json.suggestions.map((s) => [s.sku.name, s]));

  it('suggest what is below its reorder point, in whole stock units', async () => {
    const list = await suggested();
    expect(list.Shampoo).toMatchObject({ available: 2, onOrder: 0, suggestedQty: 10, leadTimeDays: 3, supplier: { name: 'Beauty Distributors' } });
    expect(list.Developer.suggestedQty).toBe(1000); // 501 ml needed -> one full 1000 ml bottle
    expect(list.Shampoo).not.toHaveProperty('lastUnitCost'); // inventory logins never see prices
  });

  it('count what is already on approved orders (but not on drafts)', async () => {
    const draft = await order('business', [{ skuId: sku.shampoo._id, qty: 10 }]);
    expect((await suggested()).Shampoo.onOrder).toBe(0);
    await act('business', draft, 'submit'); // the business owner's order is approved at once
    const list = await suggested();
    expect(list.Shampoo).toBeUndefined(); // 2 + 10 on order is above 5
    await act('business', draft, 'cancel');
    expect((await suggested()).Shampoo.onOrder).toBe(0);
  });

  it('creates one draft order per supplier; products without a supplier have to get one first', async () => {
    const refused = await call('business', 'POST', `${P}/suggestions/orders`, { body: { lines: [{ skuId: sku.mask._id, qty: 2 }] } });
    expect(refused.json.error.code).toBe('NO_SUPPLIER');
    const res = await call('business', 'POST', `${P}/suggestions/orders`, { body: { lines: [{ skuId: sku.shampoo._id, qty: 10 }, { skuId: sku.developer._id, qty: 1000 }] } });
    expect(res.json.orders).toHaveLength(1);
    expect(res.json.orders[0]).toMatchObject({ status: 'DRAFT', supplierName: 'Beauty Distributors' });
    expect(res.json.orders[0].lines.find((l) => l.skuName === 'Shampoo').unitCost).toBe(50000); // last known price
    await act('business', res.json.orders[0], 'cancel');
  });
});

describe('Approvals', () => {
  it('an order from an inventory login always waits; they can’t enter prices', async () => {
    expect((await call('inventory', 'POST', `${P}/orders`, { body: { supplierId: supplier._id, lines: [{ skuId: sku.shampoo._id, qty: 10, unitCost: 100 }] } })).status).toBe(403);
    const po = await order('inventory', [{ skuId: sku.shampoo._id, qty: 10 }]);
    expect(po.number).toMatch(/^PO-AND-\d{6}$/);
    expect((await act('inventory', po, 'submit')).json.order.status).toBe('PENDING_APPROVAL');

    // No price yet: its value is unknown, so it's above the branch owner's limit
    expect((await act('andheriOwner', po, 'decide', { approve: true })).status).toBe(403);
    const { order: current } = (await call('business', 'GET', `${P}/orders/${po._id}`)).json;
    await call('business', 'PATCH', `${P}/orders/${po._id}`, { body: { version: current.version, lines: [{ skuId: sku.shampoo._id, qty: 10, unitCost: 50000 }] } });
    const approved = await act('andheriOwner', po, 'decide', { approve: true }); // ₹5,000 is within ₹25,000
    expect(approved.json.order.status).toBe('APPROVED');
    await act('business', po, 'cancel');
  });

  it('a branch owner’s order above their limit goes to the business owner', async () => {
    const po = await order('andheriOwner', [{ skuId: sku.shampoo._id, qty: 100, unitCost: 50000 }]); // ₹50,000
    expect((await act('andheriOwner', po, 'submit')).json.order.status).toBe('PENDING_APPROVAL');
    expect((await act('andheriOwner', po, 'decide', { approve: true })).status).toBe(403); // not their own
    const back = await act('business', po, 'decide', { approve: false, note: 'Too many' });
    expect(back.json.order).toMatchObject({ status: 'DRAFT', decisionNote: 'Too many' });
    const { order: current } = (await call('business', 'GET', `${P}/orders/${po._id}`)).json;
    await call('andheriOwner', 'PATCH', `${P}/orders/${po._id}`, { body: { version: current.version, lines: [{ skuId: sku.shampoo._id, qty: 20, unitCost: 50000 }] } });
    expect((await act('andheriOwner', po, 'submit')).json.order.status).toBe('APPROVED'); // ₹10,000: within the limit
    await act('business', po, 'cancel');
  });

  it('hides prices from inventory logins and the front desk', async () => {
    const po = await order('business', [{ skuId: sku.shampoo._id, qty: 1, unitCost: 50000 }]);
    const seen = (await call('inventory', 'GET', `${P}/orders/${po._id}`)).json.order;
    expect(seen).not.toHaveProperty('total');
    expect(seen.lines[0]).not.toHaveProperty('unitCost');
    await act('business', po, 'cancel');
  });
});

describe('Receiving (AC21) and the over-receipt rule', () => {
  let po;

  it('AC21: a part delivery posts only what arrived, at the price paid', async () => {
    po = await order('business', [{ skuId: sku.shampoo._id, qty: 10, unitCost: 60000 }]);
    await act('business', po, 'submit');
    await act('business', po, 'order');
    const lineId = po.lines[0]._id;
    const res = await act('inventory', po, 'receive', { invoiceNumber: 'INV-881', lines: [{ lineId, qty: 4, batch: 'B12', expiryDate: '2027-12-31' }] });
    expect(res.json.order.status).toBe('PARTIALLY_RECEIVED');
    expect(await inStore(sku.shampoo)).toBe(6);
    // On hand: 2 at ₹500 + 4 at ₹600 -> average ₹566.67
    expect((await product(sku.shampoo)).branch.avgCost).toBeCloseTo((2 * 50000 + 4 * 60000) / 6);
    const { receipts } = (await call('business', 'GET', `${P}/orders/${po._id}`)).json;
    expect(receipts[0]).toMatchObject({ invoiceNumber: 'INV-881', lines: [{ qty: 4, batch: 'B12', unitCost: 60000 }] });
  });

  it('more than was ordered needs the business owner, with a reason', async () => {
    const lineId = po.lines[0]._id;
    expect((await act('inventory', po, 'receive', { lines: [{ lineId, qty: 8 }] })).json.error.code).toBe('OVER_RECEIPT');
    expect((await act('andheriOwner', po, 'receive', { lines: [{ lineId, qty: 8 }] })).json.error.code).toBe('OVER_RECEIPT');
    expect((await act('business', po, 'receive', { lines: [{ lineId, qty: 8 }] })).json.error.code).toBe('NOTE_REQUIRED');
    const res = await act('business', po, 'receive', { lines: [{ lineId, qty: 8 }], overReceiptReason: 'Free bottles from the supplier' });
    expect(res.json.order.status).toBe('RECEIVED');
    expect(res.json.order.lines[0].receivedQty).toBe(12);
    expect(await inStore(sku.shampoo)).toBe(14);
  });

  it('a received order can’t be cancelled, only closed', async () => {
    expect((await act('business', po, 'cancel')).status).toBe(409);
    expect((await act('business', po, 'close')).json.order.status).toBe('CLOSED');
  });

  it('the front desk receives only when an owner has switched that on', async () => {
    const next = await order('business', [{ skuId: sku.mask._id, qty: 2 }]);
    await act('business', next, 'submit');
    const body = { lines: [{ lineId: next.lines[0]._id, qty: 2 }] };
    expect((await act('desk', next, 'receive', body)).status).toBe(403);
    await InventorySettings.updateOne({ branchId: f.andheri._id }, { $set: { orgId: f.ctxGlamour.orgId, 'frontDesk.receive': true } }, { upsert: true });
    expect((await act('desk', next, 'receive', body)).json.order.status).toBe('RECEIVED');
    await InventorySettings.deleteMany({ branchId: f.andheri._id });
  });

  it('a delivery without an order, and a return to the supplier', async () => {
    const direct = await call('inventory', 'POST', `${P}/receipts`, { body: { supplierId: supplier._id, invoiceNumber: 'CASH-1', lines: [{ skuId: sku.mask._id, qty: 3 }] } });
    expect(direct.status).toBe(201);
    expect(await inStore(sku.mask)).toBe(6);
    expect((await call('desk', 'POST', `${P}/receipts`, { body: { lines: [{ skuId: sku.mask._id, qty: 1 }] } })).status).toBe(403);

    const back = await call('inventory', 'POST', `${P}/returns`, { body: { supplierId: supplier._id, reason: 'Leaking caps', lines: [{ skuId: sku.mask._id, qty: 2 }] } });
    expect(back.status).toBe(201);
    expect(await inStore(sku.mask)).toBe(4);
    const line = await InventoryLedgerEntry.findOne({ transactionId: back.json.transactionId }).lean();
    expect(line).toMatchObject({ qty: -2, bucket: 'RETURNED' });
    expect((await call('business', 'GET', `${P}/receipts`)).json.receipts.map((r) => r.kind)).toContain('RETURN');
  });
});

describe('Stock count (AC22)', () => {
  let count;
  let handout;

  it('starting saves what the records say, store and each hand-out separately; one count at a time', async () => {
    handout = (await call('business', 'POST', '/inventory/allocations', { body: { skuId: sku.shampoo._id, locationId: store._id, recipient: { kind: 'FLOOR' }, qty: 1 } })).json.allocation;
    const res = await call('inventory', 'POST', '/inventory/stock-counts');
    expect(res.status).toBe(201);
    count = res.json.count;
    const shampooStore = count.lines.find((l) => l.skuName === 'Shampoo' && l.place === 'STORE');
    const shampooHandout = count.lines.find((l) => l.place === 'HANDOUT');
    expect(shampooStore.expected).toBe(13);
    expect(shampooHandout).toMatchObject({ heldBy: 'Salon floor', expected: 1 });
    expect((await call('business', 'POST', '/inventory/stock-counts')).json.error.code).toBe('COUNT_IN_PROGRESS');
    expect((await call('desk', 'GET', '/inventory/stock-counts')).status).toBe(403);
  });

  it('every difference needs a reason before it is sent for review', async () => {
    const store1 = count.lines.find((l) => l.skuName === 'Shampoo' && l.place === 'STORE');
    const hand = count.lines.find((l) => l.place === 'HANDOUT');
    await call('inventory', 'PATCH', `/inventory/stock-counts/${count._id}`, { body: { lines: [{ lineId: store1._id, counted: 12 }, { lineId: hand._id, counted: 0 }] } });
    expect((await call('inventory', 'POST', `/inventory/stock-counts/${count._id}/submit`)).json.error.code).toBe('REASON_REQUIRED');
    await call('inventory', 'PATCH', `/inventory/stock-counts/${count._id}`, {
      body: { lines: [{ lineId: store1._id, counted: 12, reason: 'Broken bottle' }, { lineId: hand._id, counted: 0, reason: 'Not found' }] },
    });
    expect((await call('inventory', 'POST', `/inventory/stock-counts/${count._id}/submit`)).json.status).toBe('SUBMITTED');
  });

  it('only an owner approves; differences post as movements, and stock moved since then is kept', async () => {
    // Something happened after the count started: 2 more shampoo arrived
    await call('business', 'POST', `${P}/receipts`, { body: { lines: [{ skuId: sku.shampoo._id, qty: 2 }] } });
    expect((await call('inventory', 'POST', `/inventory/stock-counts/${count._id}/approve`)).status).toBe(403);

    const res = await call('andheriOwner', 'POST', `/inventory/stock-counts/${count._id}/approve`, { body: {} });
    expect(res.json.status).toBe('APPROVED');
    const totals = (await product(sku.shampoo)).totals;
    expect(totals).toMatchObject({ inStore: 14, inUse: 0 }); // 13 + 2 arrived - 1 difference; the lost hand-out is gone
    expect((await InventoryAllocation.findById(handout._id).lean()).status).toBe('CLOSED');
    const correction = await InventoryTransaction.findById(res.json.transactionIds[0]).lean();
    expect(correction).toMatchObject({ type: 'COUNT_CORRECTION', actorName: 'Meera' });
    const lines = await InventoryLedgerEntry.find({ transactionId: correction._id }).lean();
    expect(lines.map((l) => [l.qty, l.bucket]).sort()).toEqual([[-1, 'ADJUSTED'], [-1, 'ADJUSTED']]);

    const { current, past } = (await call('inventory', 'GET', '/inventory/stock-counts')).json;
    expect(current).toBe(null);
    expect(past[0]).toMatchObject({ status: 'APPROVED', countedBy: { name: 'Suresh' }, reviewedBy: { name: 'Meera' } });
  });
});

describe('Isolation', () => {
  it("another salon can't see or act on these orders", async () => {
    const po = await order('business', [{ skuId: sku.mask._id, qty: 1 }]);
    expect((await call('desert', 'GET', `${P}/orders/${po._id}`)).status).toBe(404);
    expect((await act('desert', po, 'submit')).status).toBe(404);
    expect((await act('desert', po, 'receive', { lines: [{ lineId: po.lines[0]._id, qty: 1 }] })).status).toBe(404);
  });

  it('AC24: every balance still matches the movement history', async () => {
    expect(await reconcile(f.ctxGlamour)).toEqual([]);
  });
});
