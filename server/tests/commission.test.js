import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { ActivityLog, Appointment, CommissionEntry, CommissionRule, Counter, Invoice, Notification, PayPlan, User } from '../src/models/index.js';
import { commissionAmount, splitByPrice } from '../src/modules/payroll/commission.rules.js';
import { recordInvoiceCommissions, syncCommissions } from '../src/modules/payroll/commission.service.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';
import { checkout as checkoutBill } from './billing.js';

let f;
let owner; // business owner ctx
let bandraOwner;

const now = DateTime.now().setZone('Asia/Kolkata');
const today = now.toISODate();
const thisMonth = now.startOf('month').toISODate();
const lastMonth = now.minus({ months: 1 }).startOf('month').toISODate();

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const [anita, vikram] = await User.create([
    { orgId: f.ctxGlamour.orgId, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: 'x', allBranches: true },
    { orgId: f.ctxGlamour.orgId, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
  ]);
  owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  bandraOwner = { ...f.ctxGlamour, userId: String(vikram._id), userName: 'Vikram', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all(
    [Appointment, Invoice, Counter, CommissionEntry, CommissionRule, PayPlan, ActivityLog, Notification].map((model) => model.deleteMany({}))
  );
});

// A finished appointment at Andheri. lines: [[service, stylist, price in paise]]
function completed(lines, totalPrice = lines.reduce((sum, l) => sum + l[2], 0)) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: f.priya._id,
    customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: lines.map(([service, stylist, price]) => ({
      serviceId: service._id, serviceName: service.name, staffId: stylist._id, staffName: stylist.name,
      startAt: start, endAt: start, durationMinutes: 30, price,
    })),
    startAt: start, endAt: start, totalPrice, status: 'COMPLETED',
  });
}

// Checkout, paid in full in cash, with an optional flat bill discount (paise)
function checkout(appointment, discount = 0) {
  return checkoutBill(owner, appointment, { billDiscount: { type: 'flat', value: discount } });
}

const salaryPlus = (percent, effectiveFrom = thisMonth) => ({ model: 'FIXED_COMMISSION', monthlyBase: 2000000, commissionBps: percent * 100, effectiveFrom });

describe('Commission maths', () => {
  it('shares a bill across its services by price, adding up exactly', () => {
    expect(splitByPrice([250000], 230000)).toEqual([230000]);
    expect(splitByPrice([50000, 20000], 60000)).toEqual([42857, 17143]);
    expect(splitByPrice([10000, 10000, 10000], 10000).reduce((a, b) => a + b)).toBe(10000);
  });

  it('works out commission to the nearest paisa', () => {
    expect(commissionAmount(230000, 1000)).toBe(23000);
    expect(commissionAmount(42857, 1250)).toBe(5357);
  });
});

describe('Commission at checkout', () => {
  it('PRD example: ₹2,500 service, ₹200 discount, 10% → ₹230 on ₹2,300', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    const appt = await completed([[f.haircut, f.rahul, 250000]]);
    const invoice = await checkout(appt, 20000);

    const [entry] = await CommissionEntry.find().lean();
    expect(entry).toMatchObject({ saleAmount: 230000, rateBps: 1000, amount: 23000, rateSource: 'pay_setup', day: today, invoiceNumber: invoice.invoiceNumber });
  });

  it('a completed service that is not paid yet earns nothing', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    await completed([[f.haircut, f.rahul, 50000]]);
    expect(await CommissionEntry.countDocuments()).toBe(0);
  });

  it('someone on a fixed salary only earns no commission', async () => {
    await payroll.createPlan(owner, f.rahul._id, { model: 'FIXED', monthlyBase: 2000000, effectiveFrom: thisMonth });
    await checkout(await completed([[f.haircut, f.rahul, 50000]]));
    expect(await CommissionEntry.countDocuments()).toBe(0);
  });

  it('two stylists on one combo bill each earn on their share', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    await payroll.createPlan(owner, f.neha._id, { model: 'COMMISSION', commissionBps: 2000, effectiveFrom: thisMonth });
    await checkout(await completed([[f.haircut, f.rahul, 50000], [f.beardTrim, f.neha, 20000]], 60000)); // ₹600 combo

    const entries = await CommissionEntry.find().sort('saleAmount').lean();
    expect(entries.map((e) => [e.saleAmount, e.amount])).toEqual([[17143, 3429], [42857, 4286]]);
  });

  it('a special service rate beats the normal %, and 0% means none', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    await payroll.setServiceRate(owner, f.rahul._id, f.haircut._id, { rateBps: 1500 });
    await payroll.setServiceRate(owner, f.rahul._id, f.beardTrim._id, { rateBps: 0 });
    await checkout(await completed([[f.haircut, f.rahul, 50000], [f.beardTrim, f.rahul, 20000]]));

    const entries = await CommissionEntry.find().lean();
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ serviceName: 'Haircut', rateBps: 1500, amount: 7500, rateSource: 'service_rate' });
    expect((await ActivityLog.findOne({ action: 'service_rate.set' }).lean()).summary).toBe("Set Rahul's commission on Haircut to 15% (normal rate: 10%).");
  });

  it('changing a rate later never changes commission already earned', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    await checkout(await completed([[f.haircut, f.rahul, 50000]]));
    await payroll.setServiceRate(owner, f.rahul._id, f.haircut._id, { rateBps: 2500 });
    await checkout(await completed([[f.haircut, f.rahul, 50000]]));

    const amounts = (await CommissionEntry.find().sort('createdAt').lean()).map((e) => e.amount);
    expect(amounts).toEqual([5000, 12500]);
  });

  it('working it out twice never pays twice', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    const appt = await completed([[f.haircut, f.rahul, 50000]]);
    const invoice = await checkout(appt);
    await recordInvoiceCommissions({ invoice: await Invoice.findById(invoice._id).lean(), appointment: await Appointment.findById(appt._id).lean(), timezone: 'Asia/Kolkata' });
    expect(await syncCommissions(f.ctxGlamour.orgId, { from: thisMonth, to: today })).toBe(0);
    expect(await CommissionEntry.countDocuments()).toBe(1);
  });

  it('pay set up with a past start date catches up on bills already paid', async () => {
    await checkout(await completed([[f.haircut, f.rahul, 50000]])); // paid before Rahul had a pay setup
    expect(await CommissionEntry.countDocuments()).toBe(0);

    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10, lastMonth));
    expect(await CommissionEntry.countDocuments({ staffId: f.rahul._id })).toBe(1);
  });

  it('commission lines cannot be edited', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    await checkout(await completed([[f.haircut, f.rahul, 50000]]));
    await expect(CommissionEntry.updateOne({}, { amount: 1 })).rejects.toThrow('cannot be changed');
  });
});

describe('Seeing commission', () => {
  it('the month view adds it up; other branches and salons get "not found"', async () => {
    await payroll.createPlan(owner, f.rahul._id, salaryPlus(10));
    await checkout(await completed([[f.haircut, f.rahul, 50000]]));
    await checkout(await completed([[f.beardTrim, f.rahul, 20000]]));

    const month = await payroll.getCommission(owner, f.rahul._id, today.slice(0, 7));
    expect(month).toMatchObject({ count: 2, totalSales: 70000, totalAmount: 7000 });

    const list = await payroll.listStaffPay(owner);
    expect(list.rows.find((r) => r.staff.name === 'Rahul').commissionThisMonth).toBe(7000);

    await expect(payroll.getCommission(bandraOwner, f.rahul._id, today.slice(0, 7))).rejects.toMatchObject({ status: 404 });
    await expect(payroll.getCommission({ ...f.ctxDesert, role: 'OWNER' }, f.rahul._id, today.slice(0, 7))).rejects.toMatchObject({ status: 404 });
    await expect(payroll.setServiceRate(bandraOwner, f.rahul._id, f.haircut._id, { rateBps: 100 })).rejects.toMatchObject({ status: 404 });
  });
});
