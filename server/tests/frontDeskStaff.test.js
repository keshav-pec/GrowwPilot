import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Appointment, CommissionRule, PayPlan, PayrollAdjustment, PayrollItem, PayrollRun, Staff, User } from '../src/models/index.js';
import * as monthly from '../src/modules/payroll/monthlyPayroll.service.js';
import { createStaff, findServiceStaff, updateStaff } from '../src/modules/staff/staff.service.js';
import { bookWithLock, getAvailability } from '../src/modules/appointments/scheduling.service.js';
import { createCustomer } from '../src/modules/customers/customers.service.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

let f;
let ctx; // the business owner, working in Andheri
let deskCtx; // Kavya, the Andheri front desk login
let desks; // front desk logins: { andheri, bandra }
const tomorrow = () => DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [andheri, bandra] = await User.create([
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Ritu', email: 'ritu@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
  ]);
  desks = { andheri, bandra };
  ctx = { ...f.ctxGlamour, role: 'OWNER', isPrimaryOwner: true, userName: 'Anita' };
  deskCtx = {
    orgId: f.ctxGlamour.orgId,
    userId: String(andheri._id),
    userName: 'Kavya',
    role: 'FRONT_DESK',
    isPrimaryOwner: false,
    allowedBranchIds: [String(f.andheri._id)],
    activeBranchId: String(f.andheri._id),
  };
});
afterAll(stopDb);
beforeEach(async () => {
  await Appointment.deleteMany({});
  await Staff.deleteMany({ kind: 'FRONT_DESK' });
  await Staff.deleteMany({ name: 'Sara' });
  await PayPlan.deleteMany({});
  await CommissionRule.deleteMany({});
  await Promise.all([PayrollRun, PayrollItem, PayrollAdjustment].map((m) => m.deleteMany({})));
});

const addDesk = (extra = {}) =>
  createStaff(ctx, { name: 'Kavya', role: 'Receptionist', kind: 'FRONT_DESK', branchId: String(f.andheri._id), ...extra });

const bookWith = (staffId) =>
  bookWithLock(ctx, {
    branchId: f.andheri._id,
    customerId: f.priya._id,
    date: tomorrow(),
    startTime: '14:00',
    items: [{ serviceId: f.haircut._id, staffId }],
  });

describe('Front desk members in the team list', () => {
  it('new team members are service staff unless told otherwise', async () => {
    const stylist = await createStaff(ctx, { name: 'Sara', role: 'Stylist', branchId: String(f.andheri._id) });
    expect(stylist.kind).toBe('SERVICE');
    await Staff.deleteOne({ _id: stylist._id });
  });

  it('links a front desk member to their login', async () => {
    const member = await addDesk({ userId: String(desks.andheri._id) });
    expect(member.kind).toBe('FRONT_DESK');
    expect(String(member.userId)).toBe(String(desks.andheri._id));
  });

  it('one login can only be linked to one person', async () => {
    await addDesk({ userId: String(desks.andheri._id) });
    await expect(addDesk({ name: 'Someone else', userId: String(desks.andheri._id) })).rejects.toMatchObject({ code: 'LOGIN_TAKEN' });
  });

  it("won't link a login from another branch", async () => {
    await expect(addDesk({ userId: String(desks.bandra._id) })).rejects.toMatchObject({ code: 'INVALID_USER' });
  });

  it("stylists can't be linked to a login", async () => {
    await expect(
      createStaff(ctx, { name: 'Sara', role: 'Stylist', branchId: String(f.andheri._id), userId: String(desks.andheri._id) })
    ).rejects.toMatchObject({ status: 400 });
  });

  it('switching to service staff removes the login link', async () => {
    const member = await addDesk({ userId: String(desks.andheri._id) });
    const updated = await updateStaff(ctx, member._id, { kind: 'SERVICE' });
    expect(updated.userId).toBeNull();
  });
});

describe('Front desk members are never booked', () => {
  it('rejects a booking with a front desk member', async () => {
    const member = await addDesk();
    await expect(bookWith(member._id)).rejects.toMatchObject({ status: 400, code: 'INVALID_STAFF' });
  });

  it('has no free times for a front desk member', async () => {
    const member = await addDesk();
    await expect(getAvailability(ctx, { date: tomorrow(), staffId: String(member._id) })).rejects.toMatchObject({ status: 404 });
  });

  it("can't be a customer's preferred stylist", async () => {
    const member = await addDesk();
    await expect(createCustomer(ctx, { name: 'Neel', phone: '9000000001', preferredStaffId: String(member._id) })).rejects.toMatchObject({
      code: 'INVALID_STAFF',
    });
  });

  it("a stylist with upcoming bookings can't be moved to the front desk", async () => {
    const stylist = await createStaff(ctx, { name: 'Sara', role: 'Stylist', branchId: String(f.andheri._id) });
    await bookWith(stylist._id);
    await expect(updateStaff(ctx, stylist._id, { kind: 'FRONT_DESK' })).rejects.toMatchObject({ code: 'HAS_FUTURE_BOOKINGS' });
    await Staff.deleteOne({ _id: stylist._id });
  });
});

const thisMonth = () => DateTime.now().setZone('Asia/Kolkata').startOf('month').toISODate();
const nextMonth = () => DateTime.now().setZone('Asia/Kolkata').plus({ months: 1 }).startOf('month').toISODate();
const addSara = () => createStaff(ctx, { name: 'Sara', role: 'Stylist', branchId: String(f.andheri._id) });

describe('Front desk pay setup', () => {
  it('owners can pay a front desk member a monthly salary, per day or per hour', async () => {
    const member = await addDesk();
    await expect(payroll.createPlan(ctx, member._id, { model: 'FIXED', monthlyBase: 1500000, effectiveFrom: thisMonth() })).resolves.toBeDefined();
    await expect(payroll.createPlan(ctx, member._id, { model: 'DAILY', dailyRate: 60000, effectiveFrom: nextMonth() })).resolves.toBeDefined();
  });

  it('no commission or per-service pay for front desk', async () => {
    const member = await addDesk();
    for (const plan of [
      { model: 'FIXED_COMMISSION', monthlyBase: 1500000, commissionBps: 500 },
      { model: 'COMMISSION', commissionBps: 1000 },
      { model: 'ASSIGNMENT', assignmentRate: 5000 },
      { model: 'HYBRID', dailyRate: 50000, commissionBps: 500 },
    ]) {
      await expect(payroll.createPlan(ctx, member._id, { ...plan, effectiveFrom: thisMonth() })).rejects.toMatchObject({ code: 'FRONT_DESK_PAY' });
    }
    await expect(payroll.setServiceRate(ctx, member._id, f.haircut._id, { rateBps: 1500 })).rejects.toMatchObject({ code: 'FRONT_DESK_PAY' });
  });

  it("an upcoming front desk pay change can't be edited into commission", async () => {
    const member = await addDesk();
    const plan = await payroll.createPlan(ctx, member._id, { model: 'FIXED', monthlyBase: 1500000, effectiveFrom: nextMonth() });
    await expect(
      payroll.updatePlan(ctx, plan._id, { model: 'FIXED_COMMISSION', monthlyBase: 1500000, commissionBps: 500, effectiveFrom: nextMonth() })
    ).rejects.toMatchObject({ code: 'FRONT_DESK_PAY' });
  });

  it('owners see front desk members in pay setup; front desk logins only see stylists', async () => {
    const member = await addDesk();
    const isListed = (rows) => rows.some((r) => String(r.staff._id) === String(member._id));
    expect(isListed((await payroll.listStaffPay(ctx)).rows)).toBe(true);

    const forDesk = (await payroll.listStaffPay(deskCtx)).rows;
    expect(isListed(forDesk)).toBe(false);
    expect(forDesk.some((r) => String(r.staff._id) === String(f.rahul._id))).toBe(true);
  });

  it("a front desk login can't open or ask to change front desk pay (not even their own)", async () => {
    const member = await addDesk({ userId: String(desks.andheri._id) });
    await expect(payroll.getStaffPay(deskCtx, member._id)).rejects.toMatchObject({ status: 404 });
    await expect(
      payroll.createRequest(deskCtx, { staffId: String(member._id), model: 'FIXED', monthlyBase: 2000000, effectiveFrom: nextMonth(), note: 'Raise' })
    ).rejects.toMatchObject({ status: 404 });
  });

  it('advances still leave front desk out (until Part 8)', async () => {
    const member = await addDesk();
    await expect(findServiceStaff(ctx, member._id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Moving a stylist to the front desk', () => {
  it('is blocked while their pay includes commission', async () => {
    const sara = await addSara();
    await payroll.createPlan(ctx, sara._id, { model: 'FIXED_COMMISSION', monthlyBase: 1500000, commissionBps: 1000, effectiveFrom: thisMonth() });
    await expect(updateStaff(ctx, sara._id, { kind: 'FRONT_DESK' })).rejects.toMatchObject({ code: 'PAY_NOT_FRONT_DESK' });
  });

  it('is blocked while they have special service rates', async () => {
    const sara = await addSara();
    await payroll.setServiceRate(ctx, sara._id, f.haircut._id, { rateBps: 1500 });
    await expect(updateStaff(ctx, sara._id, { kind: 'FRONT_DESK' })).rejects.toMatchObject({ code: 'PAY_NOT_FRONT_DESK' });
  });

  it('works once they are on a monthly salary', async () => {
    const sara = await addSara();
    await payroll.createPlan(ctx, sara._id, { model: 'FIXED', monthlyBase: 1500000, effectiveFrom: thisMonth() });
    await expect(updateStaff(ctx, sara._id, { kind: 'FRONT_DESK' })).resolves.toMatchObject({ kind: 'FRONT_DESK' });
  });
});

describe('Monthly payroll with a front desk section', () => {
  const lastMonth = () => DateTime.now().setZone('Asia/Kolkata').minus({ months: 1 }).toFormat('yyyy-MM');

  async function deskOnSalary() {
    const member = await addDesk();
    await payroll.createPlan(ctx, member._id, { model: 'FIXED', monthlyBase: 1500000, effectiveFrom: `${lastMonth()}-01` });
    await payroll.createPlan(ctx, f.rahul._id, { model: 'FIXED', monthlyBase: 2000000, effectiveFrom: `${lastMonth()}-01` });
    return member;
  }

  it('front desk members are paid in the month, marked as front desk, with no commission', async () => {
    const member = await deskOnSalary();
    const run = await monthly.calculateRun(ctx, lastMonth());
    const item = await PayrollItem.findOne({ runId: run._id, staffId: member._id }).lean();

    expect(item.staffKind).toBe('FRONT_DESK');
    expect(item.net).toBe(1500000);
    expect(item.lines.map((l) => l.kind)).toEqual(['salary']);

    const rahul = await PayrollItem.findOne({ runId: run._id, staffId: f.rahul._id }).lean();
    expect(rahul.staffKind).toBe('SERVICE');
  });

  it('keeps front desk totals apart, and the branch total includes both', async () => {
    await deskOnSalary();
    const run = await monthly.calculateRun(ctx, lastMonth());
    expect(run.totals.frontDesk.count).toBe(1);
    expect(run.totals.frontDesk.net).toBe(1500000);
    expect(run.totals.net).toBe(1500000 + 2000000);
  });

  it('owners can add a bonus for a front desk member', async () => {
    const member = await deskOnSalary();
    await monthly.calculateRun(ctx, lastMonth());
    await monthly.addAdjustment(ctx, { staffId: String(member._id), month: lastMonth(), kind: 'bonus', amount: 50000, reason: 'Diwali bonus' });
    const { items, run } = await monthly.getRun(ctx, lastMonth());
    expect(items.find((i) => String(i.staffId) === String(member._id)).net).toBe(1550000);
    expect(run.totals.frontDesk.net).toBe(1550000);
  });
});
