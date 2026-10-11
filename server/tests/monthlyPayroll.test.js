import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import * as models from '../src/models/index.js';
import { calculateMonthlyPay } from '../src/modules/payroll/monthlyPay.rules.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import * as monthly from '../src/modules/payroll/monthlyPayroll.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const { ActivityLog, Attendance, CommissionEntry, Notification, PayPlan, PayrollAdjustment, PayrollItem, PayrollRun, User } = models;

let f;
let owner; // business owner, working at Andheri
let bandraOwner;

const now = DateTime.now().setZone('Asia/Kolkata');
const lastMonth = now.minus({ months: 1 }).toFormat('yyyy-MM');
const thisMonth = now.toFormat('yyyy-MM');
const nextMonthOf = (month) => DateTime.fromISO(`${month}-01`).plus({ months: 1 }).toFormat('yyyy-MM');

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
  await Promise.all([PayPlan, PayrollRun, PayrollItem, PayrollAdjustment, Attendance, CommissionEntry, ActivityLog, Notification].map((m) => m.deleteMany({})));
});

// --------------------------------------------------------------------------- the calculation itself
const SEPT = '2026-09'; // 30 days
const base = { month: SEPT, countUntil: '2026-09-30', attendance: [], paidServiceDays: [], commission: { amount: 0, count: 0, sales: 0 }, adjustments: [] };
const plan = (parts, effectiveFrom = '2026-01-01', effectiveTo = null) => ({ _id: 'p', effectiveFrom, effectiveTo, ...parts });
const everyDay = (status = 'present', extra = {}) =>
  Array.from({ length: 30 }, (_, i) => ({ date: `2026-09-${String(i + 1).padStart(2, '0')}`, status, ...extra }));

describe('Working out one month', () => {
  it('fixed salary: the full amount, and absences are NOT taken off automatically', () => {
    const attendance = everyDay().map((a, i) => (i < 2 ? { ...a, status: 'absent' } : a));
    const pay = calculateMonthlyPay({ ...base, plans: [plan({ monthlyBase: 2000000 })], attendance });
    expect(pay.net).toBe(2000000);
    expect(pay.notes[0]).toBe('2 days absent (not taken off the salary automatically)');
    expect(pay.issues).toEqual([]);
  });

  it('pay changed mid-month: each setup counts for its own days', () => {
    const plans = [plan({ monthlyBase: 2000000 }, '2026-01-01', '2026-09-15'), plan({ monthlyBase: 2600000 }, '2026-09-16')];
    const pay = calculateMonthlyPay({ ...base, plans, attendance: everyDay() });
    expect(pay.lines.map((l) => l.amount)).toEqual([1000000, 1300000]); // 15/30 of each
    expect(pay.lines[1].detail).toBe('₹26,000 × 15 of 30 days');
  });

  it('per day: only days marked present; days not marked block the lock', () => {
    const attendance = everyDay().slice(0, 26).map((a, i) => (i < 2 ? { ...a, status: 'leave' } : a));
    const pay = calculateMonthlyPay({ ...base, plans: [plan({ dailyRate: 70000 })], attendance });
    expect(pay.net).toBe(24 * 70000);
    expect(pay.issues).toEqual([{ code: 'ATTENDANCE_MISSING', message: '4 days with no attendance marked (paid by attendance)', blocking: true }]);
  });

  it('per hour: check-in to check-out; a day without times blocks the lock', () => {
    const attendance = everyDay('present', { checkInAt: '2026-09-01T04:30:00Z', checkOutAt: '2026-09-01T12:00:00Z' }); // 7.5 h
    attendance[0] = { ...attendance[0], checkOutAt: null };
    const pay = calculateMonthlyPay({ ...base, plans: [plan({ hourlyRate: 15000 })], attendance });
    expect(pay.lines[0]).toMatchObject({ detail: '217.5 hours × ₹150', amount: 3262500 });
    expect(pay.issues[0]).toMatchObject({ code: 'MISSING_TIMES', blocking: true });
  });

  it('per service, commission, bonus and deduction add up', () => {
    const pay = calculateMonthlyPay({
      ...base,
      plans: [plan({ assignmentRate: 25000, commissionBps: 1000 })],
      attendance: everyDay(),
      paidServiceDays: ['2026-09-03', '2026-09-04', '2026-08-31'], // the August one doesn't count
      commission: { amount: 50000, count: 2, sales: 500000 },
      adjustments: [{ kind: 'bonus', amount: 100000, reason: 'Diwali' }, { kind: 'deduction', amount: 30000, reason: 'Advance' }],
    });
    expect(pay).toMatchObject({ gross: 50000 + 50000 + 100000, deductions: 30000, net: 170000 });
  });

  it('flags no pay setup (not for someone who has left), and pay below zero', () => {
    expect(calculateMonthlyPay({ ...base, plans: [] }).issues[0]).toMatchObject({ code: 'NO_PAY_SETUP', blocking: true });
    expect(calculateMonthlyPay({ ...base, plans: [], isActive: false }).issues).toEqual([]);
    const pay = calculateMonthlyPay({ ...base, plans: [plan({ monthlyBase: 100000 })], attendance: everyDay(), adjustments: [{ kind: 'deduction', amount: 200000, reason: 'x' }] });
    expect(pay.issues.at(-1)).toMatchObject({ code: 'NEGATIVE_NET', blocking: true });
  });
});

// --------------------------------------------------------------------------- the month for a branch
const fixed = (rupees, month = lastMonth) => ({ model: 'FIXED', monthlyBase: rupees * 100, effectiveFrom: `${month}-01` });

describe('Monthly payroll for a branch', () => {
  it('opening a month works it out; doing it again gives the same amounts', async () => {
    await payroll.createPlan(owner, f.rahul._id, fixed(20000));
    await payroll.createPlan(owner, f.neha._id, fixed(18000));

    const first = await monthly.getRun(owner, lastMonth);
    expect(first.items.map((i) => [i.staffName, i.net])).toEqual([['Neha', 1800000], ['Rahul', 2000000]]); // Ravi is inactive with nothing
    expect(first.run).toMatchObject({ status: 'draft', totals: { net: 3800000, blocking: 0 } });

    const again = await monthly.calculateRun(owner, lastMonth);
    const items = await PayrollItem.find({ runId: again._id }).sort('staffName').lean();
    expect(items.map((i) => i.net)).toEqual([1800000, 2000000]);
    expect(again.calculationVersion).toBe(2);
  });

  it('can’t lock with something blocking, or before the month ends', async () => {
    await payroll.createPlan(owner, f.rahul._id, fixed(20000)); // Neha has no pay setup
    await expect(monthly.lockRun(owner, lastMonth)).rejects.toMatchObject({ code: 'HAS_BLOCKING_ISSUES' });
    await expect(monthly.lockRun(owner, thisMonth)).rejects.toMatchObject({ code: now.endOf('month').toISODate() === now.toISODate() ? 'HAS_BLOCKING_ISSUES' : 'MONTH_NOT_OVER' });
  });

  it('locked: nothing changes; corrections go into a later month with a reason', async () => {
    await payroll.createPlan(owner, f.rahul._id, fixed(20000));
    await payroll.createPlan(owner, f.neha._id, fixed(18000));
    const locked = await monthly.lockRun(owner, lastMonth);
    expect(locked).toMatchObject({ status: 'locked', lockedByName: 'Anita' });
    expect(locked.totalsHash).toHaveLength(64);

    await expect(monthly.calculateRun(owner, lastMonth)).rejects.toMatchObject({ code: 'MONTH_LOCKED' });
    await expect(monthly.addAdjustment(owner, { staffId: String(f.rahul._id), month: lastMonth, kind: 'bonus', amount: 100000, reason: 'Late bonus' })).rejects.toMatchObject({ code: 'MONTH_LOCKED' });
    await expect(PayrollItem.updateOne({}, { net: 1 })).rejects.toThrow('cannot be changed');

    const next = nextMonthOf(lastMonth);
    await monthly.addAdjustment(owner, { staffId: String(f.rahul._id), month: next, kind: 'bonus', amount: 100000, reason: 'Missed overtime', correctsMonth: lastMonth });
    const { items } = await monthly.getRun(owner, next);
    expect(items.find((i) => i.staffName === 'Rahul').lines.at(-1)).toMatchObject({ kind: 'bonus', amount: 100000, detail: expect.stringContaining('correction for') });
  });

  it('a branch owner locks their branch and the business owner is notified', async () => {
    await payroll.createPlan(bandraOwner, f.arjun._id, fixed(18000));
    await Notification.deleteMany({});
    await monthly.lockRun(bandraOwner, lastMonth);
    const [message] = await Notification.find({ userId: owner.userId }).lean();
    expect(message.message).toMatch(/^Vikram \(Branch owner\): Locked .* payroll for Bandra: 1 person, ₹18,000 to pay\.$/);
  });

  it('bonuses and deductions are logged and only for staff at the selected branch', async () => {
    await payroll.createPlan(owner, f.rahul._id, fixed(20000));
    const adj = await monthly.addAdjustment(owner, { staffId: String(f.rahul._id), month: lastMonth, kind: 'deduction', amount: 50000, reason: 'Salary advance' });
    expect((await ActivityLog.findOne({ action: 'payroll.deduction_added' }).lean()).summary).toContain('Added a deduction of ₹500 for Rahul');
    await monthly.removeAdjustment(owner, adj._id);
    expect(await PayrollAdjustment.countDocuments()).toBe(0);

    await expect(monthly.addAdjustment(owner, { staffId: String(f.arjun._id), month: lastMonth, kind: 'bonus', amount: 100, reason: 'x x x' })).rejects.toMatchObject({ code: 'WRONG_BRANCH' });
    await expect(monthly.addAdjustment(bandraOwner, { staffId: String(f.rahul._id), month: lastMonth, kind: 'bonus', amount: 100, reason: 'x x x' })).rejects.toMatchObject({ status: 404 });
  });
});
