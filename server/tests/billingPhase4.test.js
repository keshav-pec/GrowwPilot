// Billing Phase 4: bill line kinds and payment sources as plug-ins (ready for packages, memberships, wallets),
// plus PRD checks not covered elsewhere: AC06 (numbers under load), AC18 (stock exactly once), AC24 (records can't change).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  ActivityLog, Appointment, CashMovement, CommissionEntry, Counter, CreditNote, IdempotencyRecord, InventoryBalance, InventoryTransaction, Invoice, Payment, PaymentAllocation, PayPlan, Refund, User,
} from '../src/models/index.js';
import { LINE_KINDS as KIND_NAMES, financialYear } from '../src/config/billing.js';
import { LINE_KINDS, byKind, kindOf, runHook } from '../src/modules/billing/lineKinds.js';
import { PAYMENT_SOURCES, allocationSource, sourceOf } from '../src/modules/payments/paymentSources.js';
import { computeBill } from '../src/modules/billing/tax.rules.js';
import { addProduct, createSaleDraft, issueInvoice, openDraft } from '../src/modules/invoices/invoices.service.js';
import { reversePayment } from '../src/modules/payments/payments.service.js';
import { createRefund } from '../src/modules/refunds/refunds.service.js';
import { createSku } from '../src/modules/inventory/skus/skus.service.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout, key } from './billing.js';

let f;
let owner;
let desk;
let serum;
let gel;
const FY = financialYear(new Date(), 'Asia/Kolkata');

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [anita, kavya] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  const base = { ...f.ctxGlamour, addons: ['inventory'], activeBranchId: String(f.andheri._id) };
  owner = { ...base, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  desk = { ...base, userId: String(kavya._id), userName: 'Kavya', role: 'FRONT_DESK', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };
  serum = (await createSku(owner, { name: 'Hair serum', category: 'Retail', stockUnit: 'bottle', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 100000, openingQty: 50 }, key())).sku;
  gel = (await createSku(owner, { name: 'Styling gel', category: 'Retail', stockUnit: 'tub', wayOfUse: 'MANUAL', type: 'RETAIL', sellPrice: 50000, openingQty: 1 }, key())).sku;
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all([Appointment, Invoice, Counter, Payment, PaymentAllocation, Refund, CommissionEntry, PayPlan, IdempotencyRecord].map((m) => m.deleteMany({})));
});

function completed(price = 100000) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: f.priya._id, customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 30, price }],
    startAt: start, endAt: start, totalPrice: price, status: 'COMPLETED',
  });
}
const stockOf = async (sku) => (await InventoryBalance.find({ skuId: sku._id }).lean()).reduce((s, b) => s + b.qty, 0);

// ===========================================================================
describe('Bill line kinds are plug-ins', () => {
  it('every kind of line has an entry, and an unknown kind is refused', () => {
    expect(Object.keys(LINE_KINDS).sort()).toEqual([...KIND_NAMES].sort());
    for (const kind of Object.values(LINE_KINDS)) expect(typeof kind.tax).toBe('function');
    expect(() => kindOf({ kind: 'PACKAGE' })).toThrow('Unknown kind of bill line');
  });

  it('a kind that is not discountable gets no line discount and no share of the bill discount (e.g. a gift card)', () => {
    const bill = computeBill(
      [{ name: 'Haircut', unitPrice: 100000 }, { name: 'Gift card', unitPrice: 200000, discountable: false }],
      { type: 'percent', value: 10 },
      { gstRegistered: false, pricesIncludeTax: true }
    );
    expect(bill.lines.map((l) => l.billDiscountShare)).toEqual([10000, 0]);
    expect(bill.totals.grandTotal).toBe(290000);
    expect(() => computeBill([{ name: 'Gift card', unitPrice: 200000, discountable: false, discount: { type: 'flat', value: 100 } }], null, { gstRegistered: false })).toThrow("can’t be discounted");
  });

  it('hooks run once per kind with only that kind’s lines', async () => {
    const seen = [];
    LINE_KINDS.TEST_KIND = { label: 'Test', onIssue: async (ctx, { lines }) => seen.push(lines.map((l) => l.name)) };
    try {
      const lines = [{ kind: 'SERVICE', name: 'Cut' }, { kind: 'TEST_KIND', name: 'A' }, { kind: 'TEST_KIND', name: 'B' }];
      expect(byKind(lines).map(([name, , list]) => [name, list.length])).toEqual([['SERVICE', 1], ['TEST_KIND', 2]]);
      await runHook('onIssue', {}, lines, {}, null);
      expect(seen).toEqual([['A', 'B']]);
    } finally {
      delete LINE_KINDS.TEST_KIND;
    }
  });
});

describe('Payment sources are plug-ins', () => {
  it('a new balance (e.g. a wallet) can pay a bill through the same path as advances', async () => {
    const taken = [];
    PAYMENT_SOURCES.TEST_WALLET = {
      label: 'From wallet',
      allocationField: 'walletId',
      balance: async () => 100000,
      take: async (ctx, invoice, amount) => taken.push([String(invoice._id), amount]),
    };
    try {
      const draft = await openDraft(desk, { appointmentId: (await completed())._id });
      const bill = await issueInvoice(desk, draft._id, { version: 0, sources: [{ type: 'TEST_WALLET', amount: 60000 }], payments: [{ method: 'CASH', amount: 40000 }] }, key());
      expect(bill).toMatchObject({ settlementStatus: 'PAID', amountPaid: 100000 });
      expect(taken).toEqual([[String(bill._id), 60000]]);
    } finally {
      delete PAYMENT_SOURCES.TEST_WALLET;
    }
    expect(() => sourceOf('TEST_WALLET')).toThrow('Unknown way to pay');
    expect(allocationSource({ advanceId: 'x' })).toBe('ADVANCE');
    expect(allocationSource({ paymentId: 'x' })).toBeNull();
  });
});

// ===========================================================================
describe('PRD checks', () => {
  it('AC06: bills issued at the same moment all get different numbers, with none skipped', async () => {
    const drafts = [];
    for (let i = 0; i < 8; i++) drafts.push(await openDraft(desk, { appointmentId: (await completed())._id }));
    const bills = await Promise.all(drafts.map((d) => issueInvoice(desk, d._id, { version: 0, payments: [] }, key())));
    const numbers = bills.map((b) => b.invoiceNumber).sort();
    expect(numbers).toEqual(Array.from({ length: 8 }, (_, i) => `AND/${FY}/${String(i + 1).padStart(5, '0')}`));
  });

  it('AC18: stock is taken exactly once, even when the issue is retried; a failed issue takes nothing', async () => {
    const before = await stockOf(serum);
    let draft = await createSaleDraft(desk, { customerId: String(f.priya._id) });
    draft = await addProduct(desk, draft._id, { version: 0, skuId: String(serum._id), qty: 2 });
    const k = key();
    await issueInvoice(desk, draft._id, { version: draft.version, payments: [] }, k);
    await issueInvoice(desk, draft._id, { version: draft.version, payments: [] }, k); // the same request again (network retry)
    expect(await stockOf(serum)).toBe(before - 2);
    expect(await InventoryTransaction.countDocuments({ type: 'SALE', reference: { kind: 'invoice', id: draft._id } })).toBe(1);

    // Two products, the second short: the whole issue rolls back, the first product's stock included
    let other = await createSaleDraft(desk, { customerId: String(f.priya._id) });
    other = await addProduct(desk, other._id, { version: 0, skuId: String(serum._id), qty: 1 });
    other = await addProduct(desk, other._id, { version: other.version, skuId: String(gel._id), qty: 2 });
    await expect(issueInvoice(desk, other._id, { version: other.version, payments: [] }, key())).rejects.toMatchObject({ code: 'NOT_ENOUGH_STOCK' });
    expect(await stockOf(serum)).toBe(before - 2);
  });

  it('AC24: a reversed payment stays on record with who and why; money records can never be edited', async () => {
    await payroll.createPlan(owner, f.rahul._id, { model: 'COMMISSION', commissionBps: 1000, effectiveFrom: new Date().toISOString().slice(0, 10) });
    const bill = await checkout(desk, await completed(), { payments: [{ method: 'CARD', amount: 100000 }] });
    await reversePayment(owner, bill.payments[0]._id, { reason: 'Card declined' }, key());
    await checkout(owner, await completed(), {}).then((b) => createRefund(owner, { invoiceId: b._id, lines: [{ lineId: String(b.lines[0]._id), qty: 1 }], reason: 'Unhappy' }, key()));

    const reversed = await Payment.findById(bill.payments[0]._id).lean();
    expect(reversed).toMatchObject({ status: 'REVERSED', amount: 100000, reversal: { byName: 'Anita', reason: 'Card declined' } });
    await expect(ActivityLog.updateOne({}, { summary: 'changed' })).rejects.toThrow('cannot be changed');
    await expect(CommissionEntry.updateOne({}, { amount: 0 })).rejects.toThrow('cannot be changed');
    await expect(InventoryTransaction.updateOne({}, { note: 'x' })).rejects.toThrow('cannot be changed');
    await expect(CashMovement.updateOne({}, { amount: 1 })).rejects.toThrow('cannot be changed');
    await expect(CreditNote.updateOne({}, { total: 1 })).rejects.toThrow('cannot be changed');
  });
});
