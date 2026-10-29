// Birthday & Anniversary Offers, Phase 6: reports with CSV, the discounts report, the full role table (PRD section 3)
// and salon walls. PRD AT-32 (isolation), AT-35 (the report after a refund matches billing).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { ActivityLog, Appointment, Customer, Invoice, OfferIssue, Organization, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { issueInvoice, openDraft, voidInvoice } from '../src/modules/invoices/invoices.service.js';
import { createRefund } from '../src/modules/refunds/refunds.service.js';
import { setInvoiceOffer } from '../src/modules/occasions/checkout/checkout.service.js';
import { createCampaign, publishCampaign } from '../src/modules/occasions/campaigns/campaigns.service.js';
import { recordContact, sendOffer } from '../src/modules/occasions/outreach/followup.service.js';
import { runForOrg } from '../src/modules/occasions/engine/scheduler.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { key } from './billing.js';

const PASSWORD = 'Password@123';
let f;
let g;
let owner;
let desk;
let server;
let api;
const cookies = {};
const ids = {};
const thisMonth = DateTime.now().setZone('Asia/Kolkata').month;

function completed(customer, lines) {
  const start = new Date();
  return Appointment.create({
    orgId: g, branchId: f.andheri._id, customerId: customer._id, customerSnapshot: { name: customer.name, phone: customer.phone },
    items: lines.map(([service, price]) => ({ serviceId: service._id, serviceName: service.name, staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price })),
    startAt: start, endAt: start, totalPrice: lines.reduce((sum, l) => sum + l[1], 0), status: 'COMPLETED',
  });
}
const offerOf = (customer) => OfferIssue.findOne({ customerId: customer._id }).lean();
async function useOffer(customer, lines, payments) {
  const offer = await offerOf(customer);
  const draft = await openDraft(owner, { appointmentId: (await completed(customer, lines))._id });
  const applied = await setInvoiceOffer(owner, draft._id, { offerIssueId: String(offer._id), version: draft.version });
  return issueInvoice(owner, draft._id, { version: applied.version, payments: payments ?? [{ method: 'CASH', amount: applied.grandTotal }] }, key());
}

async function login(email) {
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  return res.headers.get('set-cookie').split(';')[0];
}
async function call(who, method, path, { body, branch, headers = {} } = {}) {
  const all = { 'content-type': 'application/json', cookie: cookies[who], 'idempotency-key': key(), ...headers };
  if (branch) all['x-branch-id'] = String(branch);
  const res = await fetch(`${api}${path}`, { method, headers: all, body: body && JSON.stringify(body) });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* CSV */
  }
  return { status: res.status, json, text };
}

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const [anita, , kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Bilal', email: 'bilal@g.com', passwordHash, branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
    { orgId: f.ctxDesert.orgId, role: 'OWNER', name: 'Layla', email: 'layla@d.com', passwordHash, allBranches: true },
  ]);
  owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true, occasionOffers: true, addons: [] };
  desk = { ...f.ctxGlamour, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)], activeBranchId: String(f.andheri._id), occasionOffers: true, addons: [] };
  await migrateOccasions({ log: () => {} });
  await Organization.updateOne({ _id: g }, { $set: { 'occasionOffers.enabled': true } });
  const { campaign } = await createCampaign(owner, { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds: [String(f.haircut._id), String(f.beardTrim._id)] } }, key());
  await publishCampaign(owner, String(campaign._id), key());
  ids.campaign = String(campaign._id);

  // Five customers with a birthday this month at Andheri, one at Bandra
  const birthday = { birthday: { month: thisMonth, source: 'STAFF' } };
  const people = await Customer.create([
    { orgId: g, name: 'Asha', phone: '9700000701', homeBranchId: f.andheri._id, occasions: birthday, marketing: { WHATSAPP: { status: 'OPTED_IN' } } },
    { orgId: g, name: 'Bina', phone: '9700000702', homeBranchId: f.andheri._id, occasions: birthday },
    { orgId: g, name: 'Chitra', phone: '9700000703', homeBranchId: f.andheri._id, occasions: birthday },
    { orgId: g, name: 'Dia', phone: '9700000704', homeBranchId: f.andheri._id, occasions: birthday },
    { orgId: g, name: 'Esha', phone: '9700000705', homeBranchId: f.andheri._id, occasions: birthday },
    { orgId: g, name: 'Farah', phone: '9700000706', homeBranchId: f.bandra._id, occasions: birthday },
  ]);
  const [asha, bina, chitra, dia, esha] = people;
  await migrateOccasions({ log: () => {} });
  await runForOrg(g, { force: true });

  // Asha: messaged on WhatsApp, booked, used her offer, then a refund on part of the bill
  await sendOffer(desk, String((await offerOf(asha))._id), { channel: 'WHATSAPP' }, key());
  await Appointment.updateOne({ _id: (await completed(asha, [[f.haircut, 50000]]))._id }, { $set: { offerIssueId: (await offerOf(asha))._id, offerLinked: true, status: 'BOOKED' } });
  ids.ashaBill = await useOffer(asha, [[f.haircut, 100000], [f.beardTrim, 100000]]);
  await createRefund(owner, { invoiceId: ids.ashaBill._id, lines: [{ lineId: String(ids.ashaBill.lines[1]._id), qty: 1 }], reason: 'Beard trim not done well', method: 'CASH' }, key());
  // Bina: a call, reached
  await recordContact(desk, String((await offerOf(bina))._id), { outcome: 'REACHED' }, key());
  // Chitra: a call, no answer (not "contacted")
  await recordContact(desk, String((await offerOf(chitra))._id), { outcome: 'NO_ANSWER' }, key());
  // Dia: used her offer, then the bill was voided (the offer is back: not used, no discount counted)
  const diaBill = await useOffer(dia, [[f.haircut, 50000]], []);
  await voidInvoice(owner, diaBill._id, { reason: 'Wrong customer' }, key());
  // Esha: used her offer
  ids.eshaBill = await useOffer(esha, [[f.beardTrim, 20000]]);

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  for (const [who, email] of Object.entries({ business: 'anita@g.com', branchOwner: 'bilal@g.com', desk: 'kavya@g.com', desert: 'layla@d.com' })) cookies[who] = await login(email);
  ids.offer = String((await offerOf(bina))._id);
  ids.customer = String(bina._id);
});

afterAll(async () => {
  server?.close();
  await stopDb();
});

describe('the occasion offers report', () => {
  it('counts each step as the PRD defines it, and the money matches the bills', async () => {
    const res = await call('business', 'GET', '/occasions/reports');
    expect(res.status).toBe(200);
    const r = res.json;
    expect(r.tiles).toEqual({ issued: 6, customersContacted: 2, linkedBookings: 1, used: 2 });
    expect(r.funnel.map((s) => s.count)).toEqual([6, 2, 1, 2]);

    // AT-35: after a refund, the report matches billing
    const bills = await Invoice.find({ orgId: g, status: 'ISSUED', 'offer.offerIssueId': { $exists: true } }).lean();
    expect(bills).toHaveLength(2);
    const ashaBill = bills.find((b) => String(b._id) === String(ids.ashaBill._id));
    expect(ashaBill.creditedTotal).toBeGreaterThan(0);
    expect(r.money.associatedSales).toBe(bills.reduce((sum, b) => sum + b.grandTotal - b.creditedTotal, 0));
    expect(r.money.discounts).toBe(bills.reduce((sum, b) => sum + b.occasionDiscountTotal, 0));
    expect(r.money.discounts).toBe(30000 + 3000);
    expect(r.money.usedPercent).toBe(33.3);

    // The billing "Discounts given" report shows the same offer discounts in its own column
    const discounts = await call('business', 'GET', '/billing/reports/discounts?branches=all');
    expect(discounts.json.columns.map((c) => c.label)).toContain('Occasion offer');
    expect(discounts.json.totals.occasion).toBe(r.money.discounts);
    expect(discounts.json.totals.discount).toBe(0);

    expect(r.byBranch.map((b) => [b.branch, b.issued, b.used])).toEqual([['Andheri', 5, 2], ['Bandra', 1, 0]]);
    const kavya = r.staff.find((s) => s.name === 'Kavya');
    expect(kavya).toMatchObject({ messages: 1, calls: 2, reached: 1, contacts: 3 });
    expect(r.staff.find((s) => s.name === 'Anita')).toMatchObject({ uses: 3 }); // Dia's use counts as an action, even though the bill was voided
    expect(r.campaigns[0]).toMatchObject({ name: 'Birthday Month', versions: [{ version: 1 }] });
  });

  it('filters by channel, permission, campaign, branch and dates', async () => {
    expect((await call('business', 'GET', '/occasions/reports?channel=WHATSAPP')).json.tiles.issued).toBe(1);
    expect((await call('business', 'GET', '/occasions/reports?canMessage=yes')).json.tiles.issued).toBe(1);
    expect((await call('business', 'GET', `/occasions/reports?campaignId=${ids.campaign}`)).json.tiles.issued).toBe(6);
    expect((await call('business', 'GET', `/occasions/reports?branch=${f.bandra._id}`)).json.tiles.issued).toBe(1);
    const lastYear = DateTime.now().minus({ years: 1 }).toFormat('yyyy-MM');
    expect((await call('business', 'GET', `/occasions/reports?month=${lastYear}`)).json.tiles.issued).toBe(0);
    const today = DateTime.now().setZone('Asia/Kolkata').toISODate();
    expect((await call('business', 'GET', `/occasions/reports?from=${today}&to=${today}`)).json.tiles.issued).toBe(6);
  });

  it('a branch owner sees their branches only; the front desk can’t open it', async () => {
    const theirs = await call('branchOwner', 'GET', '/occasions/reports');
    expect(theirs.json.byBranch.map((b) => b.branch)).toEqual(['Bandra']);
    expect(theirs.json.tiles.issued).toBe(1);
    expect((await call('branchOwner', 'GET', `/occasions/reports?branch=${f.andheri._id}`)).status).toBe(403);
    expect((await call('desk', 'GET', '/occasions/reports')).status).toBe(403);
  });

  it('CSV: owners only, one row per offer with masked phones, and every download is logged', async () => {
    expect((await call('desk', 'GET', '/occasions/reports?format=csv')).status).toBe(403);
    const csv = await call('business', 'GET', '/occasions/reports?format=csv');
    expect(csv.status).toBe(200);
    const lines = csv.text.replace(/^﻿/, '').split('\n');
    expect(lines[0]).toBe('Customer,Mobile,Occasion,Month,Campaign,Version,Home branch,Offer,Can be messaged,Contacted,Message via,Linked bookings,Bill,Offer discount,Associated sale (net)');
    expect(lines).toHaveLength(7);
    expect(lines[1]).toMatch(/^Asha,97\*\*\*\*\*\*01,Birthday,.*,Birthday Month,1,Andheri,Used,Yes,Yes,WhatsApp,1,/);
    expect(csv.text).not.toContain('9700000701');
    expect(await ActivityLog.exists({ action: 'occasions.report_exported', actorName: 'Anita' })).toBeTruthy();
  });
});

describe('who can do what (PRD section 3), through the real API', () => {
  // [what, request, { business, branchOwner, desk }]
  const MATRIX = [
    ['see settings', () => ['GET', '/occasions/settings'], { business: 200, branchOwner: 200, desk: 403 }],
    ['change settings (stale version)', () => ['PUT', '/occasions/settings', { enabled: true }, { 'if-match': '999' }], { business: 409, branchOwner: 403, desk: 403 }],
    ['run the month now', () => ['POST', '/occasions/settings/run-now'], { business: 200, branchOwner: 403, desk: 403 }],
    ['see campaigns', () => ['GET', '/occasions/campaigns'], { business: 200, branchOwner: 200, desk: 403 }],
    ['open a campaign', () => ['GET', `/occasions/campaigns/${ids.campaign}`], { business: 200, branchOwner: 200, desk: 403 }],
    ['turn off the salon-wide campaign (wrong status)', () => ['POST', `/occasions/campaigns/${ids.campaign}/enable`], { business: 409, branchOwner: 403, desk: 403 }],
    ['withdraw offers (no reason)', () => ['POST', `/occasions/campaigns/${ids.campaign}/revoke`, { year: 2000 }], { business: 400, branchOwner: 400, desk: 400 }],
    ['withdraw offers', () => ['POST', `/occasions/campaigns/${ids.campaign}/revoke`, { year: 2000, reason: 'Matrix test' }], { business: 200, branchOwner: 403, desk: 403 }],
    ['see the occasion list (Andheri)', () => ['GET', '/occasions/offers?tab=all', undefined, {}, f.andheri._id], { business: 200, branchOwner: 403, desk: 200 }],
    ['open an Andheri offer', () => ['GET', `/occasions/offers/${ids.offer}`], { business: 200, branchOwner: 404, desk: 200 }],
    ['assign an Andheri offer', () => ['POST', `/occasions/offers/${ids.offer}/assign`, { assigneeId: null }], { business: 200, branchOwner: 404, desk: 200 }],
    ['change a customer’s dates', () => ['PUT', `/occasions/customers/${ids.customer}/dates`, { birthday: { month: thisMonth, day: 2 } }], { business: 200, branchOwner: 200, desk: 200 }],
    ['see messaging permission', () => ['GET', `/occasions/customers/${ids.customer}/consents`], { business: 200, branchOwner: 200, desk: 200 }],
    ['download the date template', () => ['GET', '/occasions/import/template'], { business: 200, branchOwner: 200, desk: 403 }],
    ['remove occasion data (no reason)', () => ['POST', `/occasions/customers/${ids.customer}/remove-data`, {}], { business: 400, branchOwner: 400, desk: 400 }],
    ['see reports', () => ['GET', '/occasions/reports'], { business: 200, branchOwner: 200, desk: 403 }],
    ['download the report CSV', () => ['GET', '/occasions/reports?format=csv'], { business: 200, branchOwner: 200, desk: 403 }],
  ];
  it.each(MATRIX)('%s', async (_what, request, expected) => {
    for (const who of ['business', 'branchOwner', 'desk']) {
      const [method, path, body, headers, branch] = request();
      const res = await call(who, method, path, { body, headers, branch: who === 'branchOwner' && branch ? branch : undefined });
      expect({ who, status: res.status }).toEqual({ who, status: expected[who] });
    }
  });
});

describe('AT-32: salon walls', () => {
  it('another salon sees none of this salon’s offers, campaigns or report numbers', async () => {
    const theirs = await call('desert', 'GET', '/occasions/reports');
    expect(theirs.json.tiles).toEqual({ issued: 0, customersContacted: 0, linkedBookings: 0, used: 0 });
    expect(theirs.json.campaigns).toEqual([]);
    expect((await call('desert', 'GET', `/occasions/reports?campaignId=${ids.campaign}`)).json.tiles.issued).toBe(0);
    expect((await call('desert', 'GET', `/occasions/campaigns/${ids.campaign}`)).status).toBe(404);
    expect((await call('desert', 'GET', `/occasions/campaigns/${ids.campaign}/versions`)).status).toBe(404);
    expect((await call('desert', 'POST', `/occasions/campaigns/${ids.campaign}/revoke`, { body: { year: 2026, reason: 'Spy' } })).status).toBe(404);
    expect((await call('desert', 'GET', `/occasions/offers/${ids.offer}/send-preview`)).status).toBe(404);
    expect((await call('desert', 'GET', `/occasions/customers/${ids.customer}/offers`)).status).toBe(404);
    expect((await call('desert', 'GET', `/occasions/customers/${ids.customer}/live-offers`)).status).toBe(404);
    expect((await call('business', 'GET', '/occasions/reports', { branch: f.marina._id })).status).toBe(403);
    expect((await OfferIssue.findById(ids.offer).lean()).status).toBe('ISSUED');
  });
});
