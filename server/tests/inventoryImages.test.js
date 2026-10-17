// Inventory add-on, Phase 8: product photos (GridFS), the catalogue and bulk upload by product code.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import sharp from 'sharp';
import { ActivityLog, InventorySku, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { codeFromFileName } from '../src/modules/inventory/images/images.service.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const PASSWORD = 'Password@123';

let server;
let api;
let f;
let sku;
const cookies = {};

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}

const newKey = () => `test-${new mongoose.Types.ObjectId()}`;

async function call(who, method, path, { body, key = newKey() } = {}) {
  const headers = { 'content-type': 'application/json', cookie: cookies[who], 'idempotency-key': key };
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// files: [{ name, type, data (Buffer) }]
async function upload(who, skuId, files, key = newKey()) {
  const form = new FormData();
  for (const file of files) form.append('images', new Blob([file.data], { type: file.type }), file.name);
  const res = await fetch(`${api}/inventory/skus/${skuId}/images`, { method: 'POST', headers: { cookie: cookies[who], 'idempotency-key': key }, body: form });
  return { status: res.status, json: await res.json().catch(() => null) };
}

const picture = (width = 1600, height = 1200, format = 'png') =>
  sharp({ create: { width, height, channels: 3, background: { r: 201, g: 162, b: 39 } } })[format]().toBuffer();
const png = async (name = 'photo.png') => ({ name, type: 'image/png', data: await picture() });

async function fetchImage(who, skuId, imageId, size) {
  const res = await fetch(`${api}/inventory/skus/${skuId}/images/${imageId}${size ? `?size=${size}` : ''}`, { headers: { cookie: cookies[who] } });
  return { status: res.status, type: res.headers.get('content-type'), cache: res.headers.get('cache-control'), etag: res.headers.get('etag'), data: res.ok ? Buffer.from(await res.arrayBuffer()) : null };
}

const gridFiles = () => mongoose.connection.db.collection('inventory_images.files').countDocuments();

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
  for (const [who, email] of Object.entries({ business: 'anita@g.com', desk: 'kavya@g.com', inventory: 'suresh@g.com', desert: 'layla@d.com' })) cookies[who] = await login(email);
  sku = (await call('business', 'POST', '/inventory/skus', { body: { name: 'Shampoo', category: 'Hair', stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty: 3 } })).json.sku;
});
afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('Adding photos', () => {
  let images;

  it('saves a 1000 px picture and a 240 px thumbnail; the first photo is the main one', async () => {
    const res = await upload('inventory', sku._id, [await png('front.png')]);
    expect(res.status).toBe(201);
    images = res.json.images;
    expect(images).toHaveLength(1);
    expect(images[0]).toMatchObject({ isMain: true, width: 1000, height: 750, originalName: 'front.png' });

    const thumb = await fetchImage('business', sku._id, images[0]._id, 'thumb');
    expect(thumb.type).toBe('image/webp');
    expect(thumb.cache).toContain('max-age=86400');
    expect((await sharp(thumb.data).metadata()).width).toBe(240);
    // The browser can keep it: asking again with the same tag needs no download
    const again = await fetch(`${api}/inventory/skus/${sku._id}/images/${images[0]._id}?size=thumb`, { headers: { cookie: cookies.business, 'if-none-match': thumb.etag } });
    expect(again.status).toBe(304);
  });

  it('sending the same upload twice saves it once', async () => {
    const key = newKey();
    const before = await gridFiles();
    const first = await upload('business', sku._id, [await png('side.png')], key);
    const second = await upload('business', sku._id, [await png('side.png')], key);
    expect(second.json).toEqual(first.json);
    expect(first.json.images).toHaveLength(2);
    expect(await gridFiles()).toBe(before + 2); // one picture + one thumbnail
  });

  it('accepts JPEG, PNG and WebP only, and checks the file really is a picture', async () => {
    expect((await upload('business', sku._id, [{ name: 'anim.gif', type: 'image/gif', data: Buffer.from('GIF89a') }])).json.error.code).toBe('UNSUPPORTED_IMAGE');
    const fake = await upload('business', sku._id, [{ name: 'notes.png', type: 'image/png', data: Buffer.from('this is not a picture') }]);
    expect(fake.json.error.code).toBe('UNSUPPORTED_IMAGE');
    expect((await upload('business', sku._id, [{ name: 'photo.webp', type: 'image/webp', data: await picture(600, 600, 'webp') }])).status).toBe(201);
  });

  it('refuses files over 2 MB and more than 4 photos per product', async () => {
    const big = await upload('business', sku._id, [{ name: 'huge.jpg', type: 'image/jpeg', data: Buffer.alloc(2 * 1024 * 1024 + 1) }]);
    expect(big.json.error.code).toBe('IMAGE_TOO_LARGE');
    const before = await gridFiles();
    const tooMany = await upload('business', sku._id, [await png('a.png'), await png('b.png')]); // already 3
    expect(tooMany.json.error.code).toBe('TOO_MANY_IMAGES');
    expect(await gridFiles()).toBe(before); // nothing left behind
  });

  it('chooses another main photo, and removing one is logged (the next becomes main)', async () => {
    const { images: now } = (await call('business', 'GET', `/inventory/skus/${sku._id}`)).json.sku;
    const second = now[1];
    expect((await call('business', 'PATCH', `/inventory/skus/${sku._id}/images/${second._id}`, { body: { isMain: true } })).json.images.find((i) => i.isMain)._id).toBe(second._id);

    const before = await gridFiles();
    const res = await call('business', 'DELETE', `/inventory/skus/${sku._id}/images/${second._id}`);
    expect(res.json.images).toHaveLength(2);
    expect(res.json.images[0].isMain).toBe(true);
    expect(await gridFiles()).toBe(before - 2);
    expect(await ActivityLog.exists({ action: 'inventory.photo_removed' })).toBeTruthy();
    expect((await fetchImage('business', sku._id, second._id)).status).toBe(404);
  });
});

describe('Who sees and changes photos', () => {
  it('the front desk can view photos but not add or remove them', async () => {
    const { images } = (await InventorySku.findById(sku._id).lean());
    expect((await fetchImage('desk', sku._id, images[0]._id)).status).toBe(200);
    expect((await upload('desk', sku._id, [await png()])).status).toBe(403);
    expect((await call('desk', 'DELETE', `/inventory/skus/${sku._id}/images/${images[0]._id}`)).status).toBe(403);
  });

  it("another salon's photo is not found", async () => {
    const { images } = (await InventorySku.findById(sku._id).lean());
    expect((await fetchImage('desert', sku._id, images[0]._id)).status).toBe(404);
    expect((await upload('desert', sku._id, [await png()])).status).toBe(404);
  });

  it('a deactivated product keeps its photos', async () => {
    const { sku: current } = (await call('business', 'GET', `/inventory/skus/${sku._id}`)).json;
    await call('business', 'PATCH', `/inventory/skus/${sku._id}/status`, { body: { version: current.version, status: 'inactive' } });
    const { images } = (await InventorySku.findById(sku._id).lean());
    expect(images).toHaveLength(2);
    expect((await fetchImage('business', sku._id, images[0]._id)).status).toBe(200);
  });
});

describe('Bulk upload by product code', () => {
  it('reads codes from file names, with numbered extra photos', () => {
    expect(codeFromFileName('SKU-000012.jpg')).toBe('SKU-000012');
    expect(codeFromFileName('sku-000012-2.PNG')).toBe('SKU-000012');
    expect(codeFromFileName('SKU-000012_3.webp')).toBe('SKU-000012');
    expect(codeFromFileName('SKU-000012 (2).jpg')).toBe('SKU-000012');
  });

  it('matches files to products before anything is uploaded', async () => {
    const wax = (await call('business', 'POST', '/inventory/skus', { body: { name: 'Wax', category: 'Wax', stockUnit: 'jar', wayOfUse: 'FINISH' } })).json.sku;
    const res = await call('business', 'POST', '/inventory/skus/images/bulk-match', {
      body: { fileNames: [`${wax.code}.jpg`, `${wax.code}-2.jpg`, 'SKU-999999.jpg', `${wax.code}-3.jpg`, `${wax.code}-4.jpg`, `${wax.code}-5.jpg`] },
    });
    expect(res.json.files.map((x) => x.status)).toEqual(['MATCH', 'MATCH', 'NO_MATCH', 'MATCH', 'MATCH', 'TOO_MANY']);
    expect(res.json.matched).toBe(4);
    expect((await call('desk', 'POST', '/inventory/skus/images/bulk-match', { body: { fileNames: ['x.jpg'] } })).status).toBe(403);
  });

  it('the catalogue list carries each product’s photos', async () => {
    const res = await call('business', 'GET', '/inventory/skus?status=all&perPage=500');
    expect(res.json.rows.find((r) => r.name === 'Shampoo').images).toHaveLength(2);
  });
});
