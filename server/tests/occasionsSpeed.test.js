// Birthday & Anniversary Offers: speed at 100,000 customers (OCCASION_OFFERS_PLAN.md, Phase 6).
// Targets: the monthly run under 15 minutes, the occasion list under 2 seconds per 50 rows, and the checkout
// offer preview under 700 ms. Each screen request is timed 5 times and the median is checked.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Customer, OfferIssue, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { createCampaign, publishCampaign } from '../src/modules/occasions/campaigns/campaigns.service.js';
import { runForOrg } from '../src/modules/occasions/engine/scheduler.js';
import { openDraft } from '../src/modules/invoices/invoices.service.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { key } from './billing.js';

const CUSTOMERS = 100_000;
let server;
let api;
let f;
let cookie;
let owner;
const times = {};
const thisMonth = DateTime.now().setZone('Asia/Kolkata').month;

const median = (list) => [...list].sort((a, b) => a - b)[Math.floor(list.length / 2)];
async function timed(name, work) {
  const start = performance.now();
  const result = await work();
  (times[name] ??= []).push(performance.now() - start);
  return result;
}
async function get(path) {
  const res = await fetch(`${api}${path}`, { headers: { cookie } });
  if (!res.ok) throw new Error(`GET ${path}: ${res.status} ${await res.text()}`);
  return res.json();
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = new mongoose.Types.ObjectId(f.ctxGlamour.orgId);
  const anita = await User.create({ orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: await hashPassword('Password@123'), allBranches: true });
  owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true, occasionOffers: true, addons: [] };
  await Organization.updateOne({ _id: g }, { $set: { 'occasionOffers.enabled': true } });

  // 100,000 customers over two branches; birthdays spread over the year, a third with an anniversary too
  for (let batch = 0; batch < CUSTOMERS / 10_000; batch++) {
    const docs = [];
    for (let i = 0; i < 10_000; i++) {
      const n = batch * 10_000 + i;
      const month = (Math.floor(n / 2) % 12) + 1; // both branches get every month
      docs.push({
        orgId: g,
        name: `Customer ${String(n).padStart(6, '0')}`,
        phone: `9${String(100000000 + n).padStart(9, '0')}`,
        homeBranchId: n % 2 ? f.bandra._id : f.andheri._id,
        occasions: { birthday: { month, day: (n % 28) + 1, source: 'IMPORTED' }, ...(n % 3 === 0 ? { anniversary: { month: ((n + 5) % 12) + 1, day: null, source: 'IMPORTED' } } : {}) },
        marketing: { WHATSAPP: { status: n % 4 === 0 ? 'OPTED_IN' : 'UNKNOWN' }, SMS: { status: 'UNKNOWN' }, EMAIL: { status: 'UNKNOWN' } },
      });
    }
    await Customer.collection.insertMany(docs);
  }
  const serviceIds = [String(f.haircut._id), String(f.beardTrim._id)];
  for (const input of [
    { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds } },
    { type: 'ANNIVERSARY', scope: 'BUSINESS_DEFAULT', name: 'Anniversary', rules: { discountType: 'FLAT', value: 30000, minSubtotal: 0, serviceIds } },
  ]) {
    const { campaign } = await createCampaign(owner, input, key());
    await publishCampaign(owner, String(campaign._id), key());
  }

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'anita@g.com', password: 'Password@123' }) });
  cookie = res.headers.get('set-cookie').split(';')[0];
}, 600_000);

afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('speed at 100,000 customers', () => {
  it('the monthly run gives every offer in well under 15 minutes, and running it again adds nothing', async () => {
    const result = await timed('monthly run', () => runForOrg(f.ctxGlamour.orgId, { force: true }));
    const expected = await Customer.countDocuments({ $or: [{ 'occasions.birthday.month': thisMonth }, { 'occasions.anniversary.month': thisMonth }] });
    expect(result.issued).toBeGreaterThan(8000);
    expect(await OfferIssue.countDocuments()).toBe(
      (await Customer.countDocuments({ 'occasions.birthday.month': thisMonth })) + (await Customer.countDocuments({ 'occasions.anniversary.month': thisMonth }))
    );
    expect(expected).toBeGreaterThan(0);
    const again = await timed('second run', () => runForOrg(f.ctxGlamour.orgId, { force: true }));
    expect(again.issued).toBe(0);
    console.log(`Monthly run: ${result.issued} offers in ${(times['monthly run'][0] / 1000).toFixed(1)} s; again in ${(times['second run'][0] / 1000).toFixed(1)} s`);
    expect(times['monthly run'][0]).toBeLessThan(15 * 60 * 1000);
  }, 15 * 60 * 1000);

  it('the occasion list shows 50 rows in under 2 seconds (first page, a later page, a search, a filter)', async () => {
    let cursor;
    for (let i = 0; i < 5; i++) {
      const page = await timed('list', () => get('/occasions/offers?tab=all&branch=all&limit=50'));
      expect(page.offers).toHaveLength(50);
      cursor = page.nextCursor;
      await timed('next page', () => get(`/occasions/offers?tab=all&branch=all&limit=50&cursor=${cursor}`));
      await timed('search', () => get('/occasions/offers?tab=all&branch=all&search=Customer%2009'));
      await timed('filter', () => get('/occasions/offers?tab=action&canMessage=yes&limit=50'));
      await timed('tiles', () => get('/occasions/offers/summary?branch=all'));
    }
    for (const name of ['list', 'next page', 'search', 'filter', 'tiles']) {
      console.log(`${name}: median ${median(times[name]).toFixed(0)} ms`);
      expect(median(times[name])).toBeLessThan(2000);
    }
  });

  it('the checkout offer preview answers in under 700 ms', async () => {
    const offer = await OfferIssue.findOne({ homeBranchId: f.andheri._id, type: 'BIRTHDAY' }).lean();
    const customer = await Customer.findById(offer.customerId).lean();
    const start = new Date();
    const appointment = await Appointment.create({
      orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: customer._id, customerSnapshot: { name: customer.name, phone: customer.phone },
      items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price: 50000 }],
      startAt: start, endAt: start, totalPrice: 50000, status: 'COMPLETED',
    });
    const draft = await openDraft(owner, { appointmentId: appointment._id });
    for (let i = 0; i < 5; i++) {
      const res = await timed('offer preview', () => get(`/invoices/${draft._id}/occasion-offers`));
      expect(res.offers[0]).toMatchObject({ canApply: true, discount: 7500 });
    }
    console.log(`checkout offer preview: median ${median(times['offer preview']).toFixed(0)} ms`);
    expect(median(times['offer preview'])).toBeLessThan(700);
  });
});
