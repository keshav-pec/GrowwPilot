// Inventory add-on, Phase 3: spreadsheet (CSV) import and the first-time setup guide.
// PRD AC29: the import preview flags duplicates before anything is saved.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { InventoryBalance, InventoryImport, InventorySku, InventorySkuBranch, InventoryTransaction, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { reconcile } from '../src/modules/inventory/stock/stock.engine.js';
import { checkImportRow } from '../src/modules/inventory/imports/imports.rules.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';

let server;
let api;
let f;
const cookies = {};

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}

const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

async function call(who, method, path, { body, key = method === 'GET' ? null : newKey() } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who] };
  if (key) headers['idempotency-key'] = key;
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const row = (values) => ({ name: 'Shampoo', category: 'Hair care', stock_unit: 'bottle', way_of_use: 'FINISH', ...values });
const preview = (who, rows, fileName = 'stock.csv') => call(who, 'POST', '/inventory/imports/preview', { body: { fileName, rows } });
const rowAt = (batch, line) => batch.rows.find((r) => r.row === line);
const messages = (r) => r.problems.map((p) => `${p.level}:${p.field}`);

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  await Organization.updateMany({}, { $set: { 'addons.inventory.enabled': true } });
  const g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: g, role: 'INVENTORY', name: 'Suresh', email: 'suresh@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Layla', email: 'layla@d.com', passwordHash, allBranches: true },
  ]);
  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', desk: 'kavya@g.com', inventory: 'suresh@g.com', desert: 'layla@d.com' })) {
    cookies[who] = await login(email);
  }
  // Already in the salon before the import
  const existing = await call('business', 'POST', '/inventory/skus', {
    body: { name: 'Keratin Mask', category: 'Hair care', stockUnit: 'jar', wayOfUse: 'FINISH', code: 'MASK-1', barcodes: ['111222333'] },
  });
  expect(existing.status).toBe(201);
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('Checking one row', () => {
  const check = (values, canSeeCosts = true) => checkImportRow(row(values), { canSeeCosts });

  it('accepts a correct row as it is, and leaves empty numbers empty', () => {
    const { values, problems } = check({ opening_qty: '', unit_cost: '' });
    expect(problems).toEqual([]);
    expect(values).toMatchObject({ name: 'Shampoo', wayOfUse: 'FINISH', type: 'PROFESSIONAL', openingQty: null, openingUnitCost: null });
  });

  it('flags missing name and unit, part numbers and unknown ways of use', () => {
    expect(check({ name: '', stock_unit: '' }).problems.map((p) => p.field)).toEqual(['name', 'stock_unit']);
    expect(check({ opening_qty: '2.5' }).problems[0]).toMatchObject({ field: 'opening_qty', level: 'error' });
    expect(check({ way_of_use: 'sometimes' }).problems[0]).toMatchObject({ field: 'way_of_use', level: 'error' });
  });

  it('understands the screen words for ways of use and units', () => {
    expect(check({ way_of_use: 'Per service, whole units' }).values.wayOfUse).toBe('SERVICE_UNITS');
    const measured = check({ way_of_use: 'service_measured', base_unit: 'ML', units_per_stock_unit: '1000', opening_qty: '3400' });
    expect(measured.problems).toEqual([]);
    expect(measured.values).toMatchObject({ baseUnit: 'ml', unitsPerStockUnit: 1000, openingQty: 3400 });
    expect(check({ way_of_use: 'SERVICE_MEASURED' }).problems.map((p) => p.field)).toEqual(['base_unit', 'units_per_stock_unit']);
  });

  it('takes costs only from owners, and only with an opening quantity', () => {
    expect(check({ opening_qty: '4', unit_cost: '₹450.50' }).values.openingUnitCost).toBe(45050);
    const notOwner = check({ opening_qty: '4', unit_cost: '450' }, false);
    expect(notOwner.values.openingUnitCost).toBe(null);
    expect(notOwner.problems[0]).toMatchObject({ field: 'unit_cost', level: 'warning' });
    expect(check({ unit_cost: '450' }).problems[0]).toMatchObject({ field: 'unit_cost', level: 'warning' });
  });
});

describe('Preview (AC29)', () => {
  let batch;

  it('flags duplicates in the salon and in the file before anything is saved', async () => {
    const productsBefore = await InventorySku.countDocuments();
    const res = await preview('business', [
      row({ name: 'Shampoo 1L' }), // line 2: ready
      row({ name: 'Keratin mask' }), // 3: same name as a product -> warning
      row({ name: 'Mask two', sku_code: 'mask-1' }), // 4: code taken -> error
      row({ name: 'Scanned', barcode: '111222333' }), // 5: barcode taken -> error
      row({ name: 'Wax', barcode: '999888777' }), // 6: ready
      row({ name: 'Wax refill', barcode: '999888777' }), // 7: barcode twice in the file -> error
      row({ name: 'shampoo 1l' }), // 8: name twice in the file -> warning
      row({ name: 'Odd', way_of_use: 'weekly' }), // 9: error
    ]);
    expect(res.status).toBe(201);
    batch = res.json.import;

    expect(rowAt(batch, 2).status).toBe('ready');
    expect(messages(rowAt(batch, 3))).toEqual(['warning:name']);
    expect(messages(rowAt(batch, 4))).toEqual(['error:sku_code']);
    expect(rowAt(batch, 5).problems[0].message).toMatch(/already used by Keratin Mask/);
    expect(rowAt(batch, 6).status).toBe('ready');
    expect(rowAt(batch, 7).problems[0].message).toBe('Same barcode as row 6');
    expect(messages(rowAt(batch, 8))).toEqual(['warning:name']);
    expect(rowAt(batch, 9).status).toBe('error');
    expect(batch.counts).toEqual({ ready: 2, warning: 2, error: 4 });

    expect(await InventorySku.countDocuments()).toBe(productsBefore);
  });

  it('commits only the rows without errors, minus the ones left out', async () => {
    const res = await call('business', 'POST', `/inventory/imports/${batch._id}/commit`, { body: { skipRows: [8] } });
    expect(res.status).toBe(200);
    expect(res.json).toEqual({ created: 3, withStock: 0, skipped: 5 });
    expect(await InventorySku.exists({ name: 'Odd' })).toBeFalsy();
    expect(await InventorySku.exists({ name: 'shampoo 1l' })).toBeFalsy();
    expect(await InventorySku.exists({ name: 'Wax refill' })).toBeFalsy();
  });

  it('a file is imported only once', async () => {
    const again = await call('business', 'POST', `/inventory/imports/${batch._id}/commit`, { body: {} });
    expect(again.json.error.code).toBe('ALREADY_IMPORTED');
  });
});

describe('Committing', () => {
  it('posts one opening-stock movement per product, with the cost per bottle', async () => {
    const res = await preview('business', [
      row({ name: 'Conditioner 1L', opening_qty: '10', unit_cost: '500', reorder_point: '3' }),
      row({ name: 'Developer 6%', category: 'Colour', way_of_use: 'SERVICE_MEASURED', base_unit: 'ml', units_per_stock_unit: '1000', opening_qty: '3400', unit_cost: '800' }),
      row({ name: 'Caps', stock_unit: 'pack', way_of_use: 'SERVICE_UNITS' }), // no quantity: no movement
    ]);
    const key = newKey();
    const commit = await call('business', 'POST', `/inventory/imports/${res.json.import._id}/commit`, { body: {}, key });
    expect(commit.json).toEqual({ created: 3, withStock: 2, skipped: 0 });

    const conditioner = await InventorySku.findOne({ name: 'Conditioner 1L' }).lean();
    const developer = await InventorySku.findOne({ name: 'Developer 6%' }).lean();
    const caps = await InventorySku.findOne({ name: 'Caps' }).lean();
    expect(conditioner.code).toMatch(/^SKU-\d{6}$/);
    expect((await InventoryBalance.findOne({ skuId: conditioner._id }).lean()).qty).toBe(10);
    expect((await InventoryBalance.findOne({ skuId: developer._id }).lean()).qty).toBe(3400);
    expect(await InventoryBalance.exists({ skuId: caps._id })).toBeFalsy();
    expect(await InventoryTransaction.countDocuments({ type: 'OPENING', requestKey: key })).toBe(2);

    const conditionerHere = await InventorySkuBranch.findOne({ skuId: conditioner._id }).lean();
    expect(conditionerHere).toMatchObject({ reorderPoint: 3, avgCost: 50000 });
    expect((await InventorySkuBranch.findOne({ skuId: developer._id }).lean()).avgCost).toBe(80); // ₹800 per 1000 ml
    expect((await InventorySkuBranch.findOne({ skuId: caps._id }).lean()).avgCost).toBe(null);

    // Sending the same commit again (a retry) gives the same answer and adds nothing
    const retry = await call('business', 'POST', `/inventory/imports/${res.json.import._id}/commit`, { body: {}, key });
    expect(retry.json).toEqual(commit.json);
    expect((await InventoryBalance.findOne({ skuId: conditioner._id }).lean()).qty).toBe(10);
    expect(await InventorySku.countDocuments({ name: 'Conditioner 1L' })).toBe(1);
  });

  it('refuses rows that started to clash after the preview', async () => {
    const res = await preview('business', [row({ name: 'Late', barcode: '555444333' })]);
    await call('business', 'POST', '/inventory/skus', { body: { name: 'Faster', category: 'Hair care', stockUnit: 'jar', wayOfUse: 'FINISH', barcodes: ['555444333'] } });
    const commit = await call('business', 'POST', `/inventory/imports/${res.json.import._id}/commit`, { body: {} });
    expect(commit.json.error).toMatchObject({ code: 'IMPORT_CHANGED', details: { rows: [2] } });
    expect(await InventorySku.exists({ name: 'Late' })).toBeFalsy();
    // Nothing was marked as imported, so it can be fixed and tried again
    expect((await InventoryImport.findById(res.json.import._id).lean()).status).toBe('preview');
  });

  it('handles a big file (more than the usual 100 kb), up to 2,000 rows', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) =>
      row({ name: `Bulk product number ${i + 1} with a fairly long name`, category: 'Bulk', brand: 'Some brand name', opening_qty: '5', reorder_point: '1' })
    );
    expect(JSON.stringify({ rows }).length).toBeGreaterThan(100 * 1024);
    const res = await preview('business', rows, 'big.csv');
    expect(res.status).toBe(201);
    expect(res.json.import.counts.ready).toBe(2000);
    const commit = await call('business', 'POST', `/inventory/imports/${res.json.import._id}/commit`, { body: {} });
    expect(commit.json).toEqual({ created: 2000, withStock: 2000, skipped: 0 });
    expect(await reconcile(f.ctxGlamour)).toEqual([]);
  }, 120_000);

  it('refuses more than 2,000 rows, and other routes keep the small limit', async () => {
    expect((await preview('business', Array.from({ length: 2001 }, () => row()))).status).toBe(400);
    const big = 'x'.repeat(150 * 1024);
    expect((await call('business', 'POST', '/inventory/skus', { body: { name: big } })).status).toBe(413);
  });
});

describe('Who may import', () => {
  it('an inventory login imports, but costs are left out with a warning', async () => {
    const res = await preview('inventory', [row({ name: 'Foil roll', opening_qty: '3', unit_cost: '200' })]);
    expect(messages(res.json.import.rows[0])).toEqual(['warning:unit_cost']);
    await call('inventory', 'POST', `/inventory/imports/${res.json.import._id}/commit`, { body: {} });
    const foil = await InventorySku.findOne({ name: 'Foil roll' }).lean();
    expect((await InventorySkuBranch.findOne({ skuId: foil._id }).lean()).avgCost).toBe(null);
    expect((await InventoryBalance.findOne({ skuId: foil._id }).lean()).qty).toBe(3);
  });

  it("the front desk can't import", async () => {
    expect((await preview('desk', [row()])).status).toBe(403);
  });

  it("another salon can't see or commit this salon's import", async () => {
    const res = await preview('business', [row({ name: 'Private' })]);
    expect((await call('desert', 'GET', `/inventory/imports/${res.json.import._id}`)).status).toBe(404);
    expect((await call('desert', 'POST', `/inventory/imports/${res.json.import._id}/commit`, { body: {} })).status).toBe(404);
  });
});

describe('Setup guide', () => {
  it('tracks the steps per branch until it is finished', async () => {
    const start = (await call('business', 'GET', '/inventory/setup')).json;
    expect(start.completedAt).toBe(null);
    expect(start.steps).toMatchObject({ locations: false, products: true });

    const afterStep = (await call('inventory', 'POST', '/inventory/setup/steps', { body: { step: 'locations' } })).json;
    expect(afterStep.steps.locations).toBe(true);
    const done = (await call('inventory', 'POST', '/inventory/setup/steps', { body: { step: 'done' } })).json;
    expect(done.completedAt).toBeTruthy();

    // Bandra hasn't started yet
    const bandra = await fetch(`${api}/inventory/setup`, { headers: { cookie: cookies.business, 'x-branch-id': String(f.bandra._id) } }).then((r) => r.json());
    expect(bandra.completedAt).toBe(null);
    expect(bandra.counts.products).toBe(0);
  });

  it("the front desk can't change the setup", async () => {
    expect((await call('desk', 'POST', '/inventory/setup/steps', { body: { step: 'done' } })).status).toBe(403);
  });
});
