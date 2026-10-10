import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { ActivityLog, Notification, PayChangeRequest, PayPlan, User } from '../src/models/index.js';
import { checkNewStart, cleanPayParts, describePay } from '../src/modules/payroll/payPlan.rules.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import { listActivity } from '../src/modules/activity/activity.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

let f;
let ctx; // { business, bandraOwner, andheriDesk, desert }
let users;

// Dates at the Mumbai branches
const now = DateTime.now().setZone('Asia/Kolkata');
const thisMonth = now.startOf('month').toISODate();
const nextMonth = now.plus({ months: 1 }).startOf('month').toISODate();
const inTwoMonths = now.plus({ months: 2 }).startOf('month').toISODate();

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const g = f.ctxGlamour.orgId;
  const [business, bandraOwner, andheriDesk] = await User.create([
    { orgId: g, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: 'x', allBranches: true },
    { orgId: g, role: 'OWNER', name: 'Vikram', email: 'vikram@g.com', passwordHash: 'x', branchIds: [f.bandra._id] },
    { orgId: g, role: 'FRONT_DESK', name: 'Kavya', email: 'kavya@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  users = { business, bandraOwner, andheriDesk };

  const asUser = (user, branches, extra = {}) => ({
    orgId: g,
    userId: String(user._id),
    userName: user.name,
    role: user.role,
    isPrimaryOwner: user.role === 'OWNER' && Boolean(user.allBranches),
    allowedBranchIds: branches.map((b) => String(b._id)),
    activeBranchId: String(branches[0]._id),
    ...extra,
  });
  ctx = {
    business: asUser(business, [f.andheri, f.bandra]),
    bandraOwner: asUser(bandraOwner, [f.bandra]),
    andheriDesk: asUser(andheriDesk, [f.andheri]),
    desert: { ...f.ctxDesert, userName: 'Fatima', role: 'OWNER', isPrimaryOwner: true },
  };
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all([PayPlan.deleteMany({}), PayChangeRequest.deleteMany({}), ActivityLog.deleteMany({}), Notification.deleteMany({})]);
});

const fixed = (rupees, effectiveFrom, extra = {}) => ({ model: 'FIXED', monthlyBase: rupees * 100, effectiveFrom, ...extra });
const bellOf = (user) => Notification.find({ userId: user._id }).lean();

describe('Pay setup rules', () => {
  it('keeps only the parts each way of paying uses', () => {
    expect(cleanPayParts({ model: 'FIXED', monthlyBase: 2000000, commissionBps: 1000 })).toMatchObject({ monthlyBase: 2000000, commissionBps: null });
    expect(cleanPayParts({ model: 'FIXED_COMMISSION', monthlyBase: 2000000, commissionBps: 1000 })).toMatchObject({ monthlyBase: 2000000, commissionBps: 1000 });
  });

  it('asks for the missing parts', () => {
    expect(() => cleanPayParts({ model: 'FIXED_COMMISSION', monthlyBase: 2000000 })).toThrow('Please enter: commission');
    expect(() => cleanPayParts({ model: 'DAILY' })).toThrow('day rate');
    expect(() => cleanPayParts({ model: 'HYBRID', dailyRate: 80000 })).toThrow('at least two');
  });

  it('describes pay in words', () => {
    expect(describePay({ monthlyBase: 2000000, commissionBps: 1250 })).toBe('₹20,000/month + 12.5% commission');
    expect(describePay({ dailyRate: 80050, assignmentRate: 30000 })).toBe('₹800.50/day + ₹300 per service');
    expect(describePay(null)).toBe('No pay setup');
  });

  it('a new setup must start after the latest one, which then ends the day before', () => {
    expect(checkNewStart(null, '2026-11-01', 'Rahul')).toBeNull();
    expect(checkNewStart({ effectiveFrom: '2026-10-01', effectiveTo: null }, '2026-11-01', 'Rahul')).toBe('2026-10-31');
    expect(() => checkNewStart({ effectiveFrom: '2026-11-01' }, '2026-11-01', 'Rahul')).toThrow('must start after');
  });
});

describe('Owners change pay directly', () => {
  it('business owner: sets and changes pay; old setup is closed, not rewritten; logged; no bell for themselves', async () => {
    await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, thisMonth));
    await payroll.createPlan(ctx.business, f.rahul._id, { model: 'FIXED_COMMISSION', monthlyBase: 2200000, commissionBps: 1000, effectiveFrom: nextMonth });

    const plans = await PayPlan.find({ staffId: f.rahul._id }).sort('effectiveFrom').lean();
    expect(plans).toHaveLength(2);
    expect(plans[0]).toMatchObject({ monthlyBase: 2000000, effectiveTo: DateTime.fromISO(nextMonth).minus({ days: 1 }).toISODate(), endReason: 'replaced' });
    expect(plans[1]).toMatchObject({ monthlyBase: 2200000, commissionBps: 1000, effectiveTo: null });

    const pay = await payroll.getStaffPay(ctx.business, f.rahul._id);
    expect(pay.current.monthlyBase).toBe(2000000);
    expect(pay.upcoming.monthlyBase).toBe(2200000);

    const log = await ActivityLog.find().sort('createdAt').lean();
    expect(log.map((l) => l.action)).toEqual(['pay_plan.created', 'pay_plan.created']);
    expect(log[1].summary).toContain('Changed Rahul\'s pay to ₹22,000/month + 10% commission');
    expect(log[1].actorRole).toBe('Business owner');
    expect(await Notification.countDocuments()).toBe(0);
  });

  it('branch owner: changes pay at their branch and the business owner is notified', async () => {
    await payroll.createPlan(ctx.bandraOwner, f.arjun._id, fixed(18000, thisMonth));
    const bell = await bellOf(users.business);
    expect(bell).toHaveLength(1);
    expect(bell[0].message).toContain('Vikram (Branch owner): Set Arjun\'s pay: ₹18,000/month');
  });

  it('branch owner: cannot see or change pay at another branch', async () => {
    await expect(payroll.createPlan(ctx.bandraOwner, f.rahul._id, fixed(20000, thisMonth))).rejects.toMatchObject({ status: 404 });
    await expect(payroll.getStaffPay(ctx.bandraOwner, f.rahul._id)).rejects.toMatchObject({ status: 404 });
  });

  it('another salon cannot see or change pay', async () => {
    await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, thisMonth));
    await expect(payroll.getStaffPay(ctx.desert, f.rahul._id)).rejects.toMatchObject({ status: 404 });
    const plan = await PayPlan.findOne({ staffId: f.rahul._id });
    await expect(payroll.cancelPlan(ctx.desert, plan._id)).rejects.toMatchObject({ status: 404 });
  });

  it('rejects a start date that is not after the latest setup', async () => {
    await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, nextMonth));
    await expect(payroll.createPlan(ctx.business, f.rahul._id, fixed(21000, nextMonth))).rejects.toMatchObject({ code: 'PLAN_DATE_CONFLICT' });
    await expect(payroll.createPlan(ctx.business, f.rahul._id, fixed(21000, thisMonth))).rejects.toMatchObject({ code: 'PLAN_DATE_CONFLICT' });
  });

  it('an upcoming change can be edited or cancelled; the previous setup carries on', async () => {
    await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, thisMonth));
    const upcoming = await payroll.createPlan(ctx.business, f.rahul._id, fixed(22000, nextMonth));

    await payroll.updatePlan(ctx.business, upcoming._id, fixed(23000, inTwoMonths));
    let first = await PayPlan.findOne({ staffId: f.rahul._id, effectiveFrom: thisMonth }).lean();
    expect(first.effectiveTo).toBe(DateTime.fromISO(inTwoMonths).minus({ days: 1 }).toISODate());

    await payroll.cancelPlan(ctx.business, upcoming._id);
    first = await PayPlan.findOne({ staffId: f.rahul._id, effectiveFrom: thisMonth }).lean();
    expect(first).toMatchObject({ effectiveTo: null, endReason: null });
    expect(await PayPlan.countDocuments({ staffId: f.rahul._id })).toBe(1);
  });

  it('a setup that has started cannot be edited, only ended', async () => {
    const plan = await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, thisMonth));
    await expect(payroll.updatePlan(ctx.business, plan._id, fixed(25000, thisMonth))).rejects.toMatchObject({ code: 'PLAN_STARTED' });

    const lastDay = now.endOf('month').toISODate();
    await payroll.endPlan(ctx.business, plan._id, { effectiveTo: lastDay });
    expect(await PayPlan.findById(plan._id).lean()).toMatchObject({ effectiveTo: lastDay, endReason: 'ended' });
  });
});

describe('Front desk requests a change, an owner approves', () => {
  it('front desk sees the pay setup but not the history', async () => {
    await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, thisMonth));
    const pay = await payroll.getStaffPay(ctx.andheriDesk, f.rahul._id);
    expect(pay.current.monthlyBase).toBe(2000000);
    expect(pay.history).toBeUndefined();
  });

  it('request → approvers notified → approve → new setup, requester and business owner notified', async () => {
    await payroll.createPlan(ctx.business, f.arjun._id, fixed(18000, thisMonth));
    const bandraDesk = { ...ctx.andheriDesk, allowedBranchIds: [String(f.bandra._id)], activeBranchId: String(f.bandra._id) };

    const request = await payroll.createRequest(bandraDesk, { staffId: String(f.arjun._id), ...fixed(19000, nextMonth), note: 'Yearly raise' });
    expect(await PayPlan.countDocuments({ staffId: f.arjun._id })).toBe(1); // nothing changes until approved
    expect((await bellOf(users.bandraOwner))[0].message).toContain('Asked to change Arjun\'s pay to ₹19,000/month');
    expect(await bellOf(users.business)).toHaveLength(1);

    // Only one open request per person
    await expect(payroll.createRequest(bandraDesk, { staffId: String(f.arjun._id), ...fixed(19500, nextMonth), note: 'Again' })).rejects.toMatchObject({ code: 'REQUEST_PENDING' });

    await Notification.deleteMany({});
    await payroll.approveRequest(ctx.bandraOwner, request._id, {});
    const plans = await PayPlan.find({ staffId: f.arjun._id }).sort('effectiveFrom').lean();
    expect(plans[1]).toMatchObject({ monthlyBase: 1900000, effectiveFrom: nextMonth });
    expect(String(plans[1].requestId)).toBe(String(request._id));
    expect(await PayChangeRequest.findById(request._id).lean()).toMatchObject({ status: 'approved', decidedByName: 'Vikram' });
    expect((await bellOf(users.andheriDesk))[0].message).toContain('Vikram approved your pay change for Arjun');
    expect((await bellOf(users.business))[0].message).toContain('Vikram (Branch owner): Approved');

    // Can't be answered twice
    await expect(payroll.approveRequest(ctx.business, request._id, {})).rejects.toMatchObject({ code: 'REQUEST_CLOSED' });
  });

  it('a branch owner cannot answer requests from another branch', async () => {
    const request = await payroll.createRequest(ctx.andheriDesk, { staffId: String(f.rahul._id), ...fixed(20000, thisMonth), note: 'New joiner' });
    await expect(payroll.approveRequest(ctx.bandraOwner, request._id, {})).rejects.toMatchObject({ status: 404 });
    await payroll.rejectRequest(ctx.business, request._id, { note: 'Too high for now' });
    expect(await PayPlan.countDocuments()).toBe(0);
    expect((await bellOf(users.andheriDesk))[0].message).toContain('did not approve your pay change for Rahul. Note: Too high for now');
  });

  it('front desk cannot request a change for a stylist at another branch', async () => {
    await expect(payroll.createRequest(ctx.andheriDesk, { staffId: String(f.arjun._id), ...fixed(20000, thisMonth), note: 'x x x' })).rejects.toMatchObject({ status: 404 });
  });
});

describe('Activity log', () => {
  it('branch owners only see their branches; the business owner sees everything', async () => {
    await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, thisMonth)); // Andheri
    await payroll.createPlan(ctx.bandraOwner, f.arjun._id, fixed(18000, thisMonth)); // Bandra
    expect((await listActivity(ctx.business, { page: 1 })).total).toBe(2);
    const bandra = await listActivity(ctx.bandraOwner, { page: 1 });
    expect(bandra.items.map((i) => i.summary)).toEqual([expect.stringContaining('Arjun')]);
  });

  it('entries cannot be edited', async () => {
    await payroll.createPlan(ctx.business, f.rahul._id, fixed(20000, thisMonth));
    await expect(ActivityLog.updateOne({}, { summary: 'changed' })).rejects.toThrow('cannot be changed');
  });
});
