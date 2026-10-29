// Birthday & Anniversary Offers, Phase 5: offers on bookings and at checkout.
// PRD AT-17 to AT-28, and old bills without an offer price the same.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, BillingSettings, Customer, Invoice, OfferEvent, OfferIssue, Organization, Service, User } from '../src/models/index.js';
import { hashPassword } from '../src/utils/password.js';
import { computeBill, occasionDiscount } from '../src/modules/billing/tax.rules.js';
import { issueInvoice, openDraft, quoteDraft, saveDraft, voidInvoice } from '../src/modules/invoices/invoices.service.js';
import { offersForInvoice, setInvoiceOffer } from '../src/modules/occasions/checkout/checkout.service.js';
import { createCampaign, publishCampaign } from '../src/modules/occasions/campaigns/campaigns.service.js';
import { runForOrg } from '../src/modules/occasions/engine/scheduler.js';
import { migrateOccasions } from '../src/scripts/migrate-occasions-v1.js';
import app from '../src/app.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { key } from './billing.js';

const PASSWORD = 'Password@123';
const ANDHERI_GSTIN = '27AAKCG4821M1Z5';
let f;
let g;
let owner;
let desk;
let server;
let api;
let deskCookie;
const thisMonth = DateTime.now().setZone('Asia/Kolkata').month;

// A finished appointment at Andheri for a customer. lines: [[service, price in paise]]
function completed(customer, lines, { status = 'COMPLETED', totalPrice } = {}) {
  const start = new Date();
  return Appointment.create({
    orgId: g, branchId: f.andheri._id, customerId: customer._id,
    customerSnapshot: { name: customer.name, phone: customer.phone },
    items: lines.map(([service, price]) => ({ serviceId: service._id, serviceName: service.name, staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price })),
    startAt: start, endAt: start, totalPrice: totalPrice ?? lines.reduce((sum, l) => sum + l[1], 0), status,
  });
}
let n = 0;
async function birthdayCustomer(name, extra = {}) {
  n += 1;
  const customer = await Customer.create({ orgId: g, name, phone: `97000006${String(n).padStart(2, '0')}`, homeBranchId: f.andheri._id, occasions: { birthday: { month: thisMonth, source: 'STAFF' }, ...extra } });
  await runForOrg(g, { force: true });
  return customer;
}
const offerOf = (customer, type = 'BIRTHDAY') => OfferIssue.findOne({ customerId: customer._id, type }).lean();
const cash = (amount) => [{ method: 'CASH', amount }];

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  g = f.ctxGlamour.orgId;
  const passwordHash = await hashPassword(PASSWORD);
  const [anita, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash, allBranches: true },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash, branchIds: [f.andheri._id] },
  ]);
  owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true, occasionOffers: true, addons: [] };
  desk = { ...f.ctxGlamour, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)], activeBranchId: String(f.andheri._id), occasionOffers: true, addons: [] };
  await migrateOccasions({ log: () => {} });
  await Organization.updateOne({ _id: g }, { $set: { 'occasionOffers.enabled': true } });

  const services = [String(f.haircut._id), String(f.beardTrim._id)];
  for (const input of [
    { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0, serviceIds: services } },
    { type: 'ANNIVERSARY', scope: 'BUSINESS_DEFAULT', name: 'Anniversary Month', rules: { discountType: 'FLAT', value: 30000, minSubtotal: 150000, serviceIds: [String(f.haircut._id)] } },
  ]) {
    const { campaign } = await createCampaign(owner, input, key());
    await publishCampaign(owner, String(campaign._id), key());
  }

  server = app.listen(0);
  api = `http://127.0.0.1:${server.address().port}/api`;
  const res = await fetch(`${api}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'kavya@g.com', password: PASSWORD }) });
  deskCookie = res.headers.get('set-cookie').split(';')[0];
});

afterAll(async () => {
  server?.close();
  await stopDb();
});

async function call(method, path, body) {
  const headers = { 'content-type': 'application/json', cookie: deskCookie, 'idempotency-key': key() };
  const res = await fetch(`${api}${path}`, { method, headers, body: body && JSON.stringify(body) });
  return { status: res.status, json: await res.json().catch(() => null) };
}

// ===========================================================================
describe('the offer in the bill maths', () => {
  const plain = { gstRegistered: false, pricesIncludeTax: true };
  const line = (unitPrice, extra = {}) => ({ unitPrice, qty: 1, taxRateBps: 1800, occasionEligible: true, ...extra });
  const pct = { discountType: 'PERCENT', value: 1500, maxDiscount: 50000, minSubtotal: 0 };

  it('AT-21: 15% of ₹2,000 (max ₹500) is ₹300, spread over the eligible lines', () => {
    const bill = computeBill([line(100000), line(100000)], null, plain, pct);
    expect(bill.occasion).toMatchObject({ eligible: true, discount: 30000, eligibleSubtotal: 200000 });
    expect(bill.lines.map((l) => l.occasionDiscount)).toEqual([15000, 15000]);
    expect(bill.totals).toMatchObject({ occasionDiscountTotal: 30000, manualDiscount: 0, discountTotal: 30000, grandTotal: 170000 });
    // capped at the maximum
    expect(computeBill([line(500000)], null, plain, pct).occasion.discount).toBe(50000);
  });

  it('AT-22: a flat ₹300 offer on ₹200 of eligible services takes ₹200; lines that don’t count are untouched', () => {
    const bill = computeBill([line(20000), line(80000, { occasionEligible: false })], null, plain, { discountType: 'FLAT', value: 30000, minSubtotal: 0 });
    expect(bill.lines.map((l) => l.occasionDiscount)).toEqual([20000, 0]);
    expect(bill.lines.map((l) => l.lineTotal)).toEqual([0, 80000]);
  });

  it('AT-20 / AT-19: ₹1,499.99 against a ₹1,500 minimum is refused; no eligible service gives nothing', () => {
    expect(occasionDiscount({ discountType: 'FLAT', value: 30000, minSubtotal: 150000 }, 149999)).toEqual({ eligible: false, discount: 0, code: 'MIN_SPEND', shortBy: 1 });
    expect(occasionDiscount({ discountType: 'FLAT', value: 30000, minSubtotal: 150000 }, 150000)).toEqual({ eligible: true, discount: 30000 });
    expect(computeBill([line(50000, { occasionEligible: false })], null, plain, pct).occasion).toMatchObject({ eligible: false, code: 'NO_ELIGIBLE_SERVICE', discount: 0 });
  });

  it('AT-23: different GST rates, prices with and without GST: the offer comes off first, GST is worked out on what is left', () => {
    const lines = [line(118000, { taxRateBps: 1800 }), line(105000, { taxRateBps: 500 }), line(33333, { taxRateBps: 1800 })];
    for (const mode of [{ gstRegistered: true, pricesIncludeTax: true }, { gstRegistered: true, pricesIncludeTax: false }]) {
      const bill = computeBill(lines, null, mode, pct);
      const off = bill.lines.map((l) => l.occasionDiscount);
      expect(off.reduce((a, b) => a + b, 0)).toBe(bill.occasion.discount);
      expect(bill.occasion.discount).toBe(Math.min(Math.floor((256333 * 1500 + 5000) / 10000), 50000)); // 15% to the paisa, capped
      bill.lines.forEach((l, i) => {
        const after = lines[i].unitPrice - off[i];
        expect(after).toBeGreaterThanOrEqual(0);
        expect(l.taxableAmount + l.cgst + l.sgst).toBe(l.lineTotal);
        expect(mode.pricesIncludeTax ? l.lineTotal : l.taxableAmount).toBe(after);
      });
    }
  });

  it('a bill without an offer prices exactly as before', () => {
    const lines = [line(118000, { occasionEligible: false }), line(105000, { taxRateBps: 500, occasionEligible: false })];
    const mode = { gstRegistered: true, pricesIncludeTax: true };
    const before = computeBill(lines, { type: 'percent', value: 10 }, mode);
    expect(before.occasion).toBeNull();
    expect(before.totals.occasionDiscountTotal).toBe(0);
    expect(before.totals.discountTotal).toBe(before.totals.manualDiscount);
  });
});

// ===========================================================================
describe('bookings', () => {
  it('AT-17: booking from the list links the offer and uses nothing; an ordinary booking isn’t linked', async () => {
    const asha = await birthdayCustomer('Asha');
    const offer = await offerOf(asha);
    const date = DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();
    const linked = await call('POST', '/appointments', { customerId: String(asha._id), date, startTime: '11:00', items: [{ serviceId: String(f.haircut._id), staffId: String(f.rahul._id) }], offerIssueId: String(offer._id) });
    expect(linked.status).toBe(201);
    const appointment = await Appointment.findById(linked.json.appointment?._id ?? linked.json._id).lean();
    expect(appointment).toMatchObject({ offerLinked: true });
    expect(String(appointment.offerIssueId)).toBe(String(offer._id));
    const after = await OfferIssue.findById(offer._id).lean();
    expect(after.status).toBe('ISSUED');
    expect(after.appointmentIds.map(String)).toEqual([String(appointment._id)]);
    expect(await OfferEvent.exists({ offerId: offer._id, kind: 'BOOKED' })).toBeTruthy();

    const plain = await call('POST', '/appointments', { customerId: String(asha._id), date, startTime: '15:00', items: [{ serviceId: String(f.haircut._id), staffId: String(f.neha._id) }] });
    const plainAppointment = await Appointment.findById(plain.json.appointment?._id ?? plain.json._id).lean();
    expect(plainAppointment.offerLinked).toBe(false);

    // Someone else's offer can't be linked
    const other = await birthdayCustomer('Other');
    const wrong = await call('POST', '/appointments', { customerId: String(asha._id), date, startTime: '17:00', items: [{ serviceId: String(f.haircut._id), staffId: String(f.rahul._id) }], offerIssueId: String((await offerOf(other))._id) });
    expect(wrong.json.error.code).toBe('OFFER_NOT_AVAILABLE');

    // AT-18: cancelling the booking leaves the offer usable
    await call('PATCH', `/appointments/${appointment._id}/status`, { status: 'CANCELLED', reason: 'Customer busy' });
    expect((await OfferIssue.findById(offer._id).lean()).status).toBe('ISSUED');

    // The booking box: likely discount on the chosen services
    const live = await call('GET', `/occasions/customers/${asha._id}/live-offers?serviceIds=${f.haircut._id}`);
    expect(live.json.offers[0]).toMatchObject({ label: 'Birthday offer', potentialDiscount: 7500, maxDiscount: 50000 });
  });
});

// ===========================================================================
describe('checkout', () => {
  it('lists the offer with the server’s numbers, applies it, and issuing the bill uses it', async () => {
    const meera = await birthdayCustomer('Meera');
    const offer = await offerOf(meera);
    const appt = await completed(meera, [[f.haircut, 100000], [f.beardTrim, 100000]]);
    const draft = await openDraft(desk, { appointmentId: appt._id });
    expect(draft.offer).toBeNull(); // never applied by itself

    const choices = await offersForInvoice(desk, draft._id);
    expect(choices.offers).toHaveLength(1);
    expect(choices.offers[0]).toMatchObject({ canApply: true, eligibleSubtotal: 200000, discount: 30000, payable: 170000, label: 'Birthday offer' });

    const applied = await setInvoiceOffer(desk, draft._id, { offerIssueId: String(offer._id), version: draft.version });
    expect(applied.offer).toMatchObject({ discount: 30000, campaignName: 'Birthday Month', eligible: true });
    expect(applied.lines.map((l) => l.occasionDiscount)).toEqual([15000, 15000]);
    expect(applied).toMatchObject({ occasionDiscountTotal: 30000, manualDiscount: 0, grandTotal: 170000 });
    expect((await OfferIssue.findById(offer._id).lean()).status).toBe('ISSUED'); // not used yet

    const issued = await issueInvoice(desk, draft._id, { version: applied.version, payments: cash(170000) }, key());
    expect(issued.status).toBe('ISSUED');
    const used = await OfferIssue.findById(offer._id).lean();
    expect(used).toMatchObject({ status: 'REDEEMED', discountGiven: 30000 });
    expect(String(used.invoiceId)).toBe(String(draft._id));
    expect(used.task).toMatchObject({ state: 'CLOSED', closedReason: 'REDEEMED' });

    // On another bill it shows why it can't be used
    const again = await openDraft(desk, { appointmentId: (await completed(meera, [[f.haircut, 50000]]))._id });
    const second = await offersForInvoice(desk, again._id);
    expect(second.offers[0]).toMatchObject({ canApply: false, code: 'REDEEMED' });
    expect(second.offers[0].reason).toMatch(new RegExp(`^Offer redeemed on invoice ${issued.invoiceNumber.replaceAll('/', '\\/')} at Andheri`));
  });

  it('AT-19 / AT-20: no eligible service, or not enough spend, can’t be applied', async () => {
    const both = await birthdayCustomer('Both', { anniversary: { month: thisMonth, source: 'STAFF' } });
    const draft = await openDraft(desk, { appointmentId: (await completed(both, [[f.facial, 120000], [f.haircut, 149999]]))._id });
    const rows = (await offersForInvoice(desk, draft._id)).offers;
    const anniversary = rows.find((o) => o.type === 'ANNIVERSARY');
    expect(anniversary).toMatchObject({ canApply: false, code: 'MIN_SPEND', reason: 'Add ₹0.01 of eligible services to qualify for this offer' });
    await expect(setInvoiceOffer(desk, draft._id, { offerIssueId: String(anniversary._id), version: draft.version })).rejects.toMatchObject({ code: 'MIN_SPEND' });

    const facialOnly = await openDraft(desk, { appointmentId: (await completed(both, [[f.facial, 120000]]))._id });
    const birthday = (await offersForInvoice(desk, facialOnly._id)).offers.find((o) => o.type === 'BIRTHDAY');
    expect(birthday).toMatchObject({ canApply: false, code: 'NO_ELIGIBLE_SERVICE', reason: 'No eligible service on this bill' });
  });

  it('AT-24: doesn’t mix with other discounts; editing the bill re-works the offer', async () => {
    const tara = await birthdayCustomer('Tara');
    const offer = await offerOf(tara);
    const draft = await openDraft(owner, { appointmentId: (await completed(tara, [[f.haircut, 100000]]))._id });
    const discounted = await saveDraft(owner, draft._id, { version: draft.version, billDiscount: { type: 'flat', value: 5000 } });
    expect((await offersForInvoice(owner, draft._id)).offers[0]).toMatchObject({ canApply: false, code: 'OTHER_DISCOUNT' });
    await expect(setInvoiceOffer(owner, draft._id, { offerIssueId: String(offer._id), version: discounted.version })).rejects.toMatchObject({ code: 'OFFER_NO_MIXING' });

    const cleared = await saveDraft(owner, draft._id, { version: discounted.version, billDiscount: null });
    const applied = await setInvoiceOffer(owner, draft._id, { offerIssueId: String(offer._id), version: cleared.version });
    await expect(saveDraft(owner, draft._id, { version: applied.version, billDiscount: { type: 'percent', value: 5 } })).rejects.toMatchObject({ code: 'OFFER_NO_MIXING' });

    // An owner lowers the price: the offer is re-worked straight away (15% of ₹600 = ₹90)
    const lineId = String(applied.lines[0]._id);
    const quote = await quoteDraft(owner, draft._id, { lines: [{ lineId, unitPrice: 60000, priceChangeReason: 'Short hair' }] });
    expect(quote.offer.discount).toBe(9000);
    expect(quote.grandTotal).toBe(51000);

    const removed = await setInvoiceOffer(owner, draft._id, { offerIssueId: null, version: applied.version });
    expect(removed).toMatchObject({ offer: null, occasionDiscountTotal: 0, grandTotal: 100000 });
  });

  it('AT-25: two bills issued at the same moment: one wins, the other gets OFFER_TAKEN and nothing is used', async () => {
    const twin = await birthdayCustomer('Twin');
    const offer = await offerOf(twin);
    const a = await openDraft(desk, { appointmentId: (await completed(twin, [[f.haircut, 100000]]))._id });
    const b = await openDraft(owner, { appointmentId: (await completed(twin, [[f.beardTrim, 100000]]))._id });
    const aa = await setInvoiceOffer(desk, a._id, { offerIssueId: String(offer._id), version: a.version });
    const bb = await setInvoiceOffer(owner, b._id, { offerIssueId: String(offer._id), version: b.version });

    const results = await Promise.allSettled([
      issueInvoice(desk, a._id, { version: aa.version, payments: cash(85000) }, key()),
      issueInvoice(owner, b._id, { version: bb.version, payments: cash(85000) }, key()),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
    const lost = results.find((r) => r.status === 'rejected').reason;
    expect(lost.code).toBe('OFFER_TAKEN');
    expect(lost.message).toBe('Offer was redeemed elsewhere. Invoice refreshed; please review payable.');

    const bills = await Invoice.find({ _id: { $in: [a._id, b._id] } }).lean();
    const loser = bills.find((x) => x.status === 'DRAFT');
    expect(loser).toMatchObject({ offer: null, occasionDiscountTotal: 0, grandTotal: 100000 }); // taken off and re-priced
    expect(bills.filter((x) => x.status === 'ISSUED')).toHaveLength(1);
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'REDEEMED' })).toBe(1);
  });

  it('AT-26: if the payment fails, the offer is not used', async () => {
    const pay = await birthdayCustomer('Payfail');
    const offer = await offerOf(pay);
    const draft = await openDraft(desk, { appointmentId: (await completed(pay, [[f.haircut, 100000]]))._id });
    const applied = await setInvoiceOffer(desk, draft._id, { offerIssueId: String(offer._id), version: draft.version });
    await expect(issueInvoice(desk, draft._id, { version: applied.version, useAdvance: 5000, payments: [] }, key())).rejects.toBeTruthy();
    expect((await OfferIssue.findById(offer._id).lean()).status).toBe('ISSUED');
    expect((await Invoice.findById(draft._id).lean()).status).toBe('DRAFT');
  });

  it('AT-27 / AT-28: a void in the month gives the offer back once; after the month it stays expired', async () => {
    const vee = await birthdayCustomer('Vee');
    const offer = await offerOf(vee);
    const appt = await completed(vee, [[f.haircut, 100000]]);
    const draft = await openDraft(owner, { appointmentId: appt._id });
    const applied = await setInvoiceOffer(owner, draft._id, { offerIssueId: String(offer._id), version: draft.version });
    const issued = await issueInvoice(owner, draft._id, { version: applied.version, payments: [] }, key());
    await voidInvoice(owner, issued._id, { reason: 'Wrong customer' }, key());
    const back = await OfferIssue.findById(offer._id).lean();
    expect(back).toMatchObject({ status: 'ISSUED', invoiceId: null, discountGiven: null });
    expect(back.task.state).not.toBe('CLOSED');
    expect(await OfferEvent.countDocuments({ offerId: offer._id, kind: 'RESTORED' })).toBe(1);

    // Usable again (exactly once): a new bill for the same appointment uses it
    const redo = await openDraft(owner, { appointmentId: appt._id });
    const reapplied = await setInvoiceOffer(owner, redo._id, { offerIssueId: String(offer._id), version: redo.version });
    const reissued = await issueInvoice(owner, redo._id, { version: reapplied.version, payments: [] }, key());
    expect((await OfferIssue.findById(offer._id).lean()).status).toBe('REDEEMED');

    // AT-28: voided after the offer's month: it stays expired
    await OfferIssue.updateOne({ _id: offer._id }, { $set: { validUntil: new Date(Date.now() - 1000) } });
    await voidInvoice(owner, reissued._id, { reason: 'Mistake again' }, key());
    expect((await OfferIssue.findById(offer._id).lean()).status).toBe('EXPIRED');
  });

  it('GST bills: the offer comes off before GST at each line’s own rate, and the PDF prints', async () => {
    await BillingSettings.create({ orgId: g, legalName: 'Glamour Studio Pvt Ltd', gstRegistered: true, branches: [{ branchId: f.andheri._id, gstin: ANDHERI_GSTIN, stateCode: '27' }] });
    await Service.updateOne({ _id: f.beardTrim._id }, { $set: { taxRateBps: 500 } });
    const gst = await birthdayCustomer('Gst');
    const offer = await offerOf(gst);
    const draft = await openDraft(owner, { appointmentId: (await completed(gst, [[f.haircut, 118000], [f.beardTrim, 105000]]))._id });
    const applied = await setInvoiceOffer(owner, draft._id, { offerIssueId: String(offer._id), version: draft.version });
    expect(applied.offer.discount).toBe(Math.floor((223000 * 1500 + 5000) / 10000));
    applied.lines.forEach((l) => expect(l.taxableAmount + l.cgst + l.sgst).toBe(l.lineTotal));
    const issued = await issueInvoice(owner, draft._id, { version: applied.version, payments: cash(applied.grandTotal) }, key());
    expect(issued.taxSummary.map((r) => r.rateBps)).toEqual([500, 1800]);

    const pdf = await fetch(`${api}/invoices/${issued._id}/pdf`, { headers: { cookie: deskCookie } });
    expect(pdf.status).toBe(200);
    expect((await OfferIssue.findById(offer._id).lean()).status).toBe('REDEEMED');
  });
});
