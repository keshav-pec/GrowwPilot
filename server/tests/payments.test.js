import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { DateTime } from 'luxon';
import * as models from '../src/models/index.js';
import { advanceRepayment } from '../src/modules/payroll/monthlyPay.rules.js';
import * as payroll from '../src/modules/payroll/payroll.service.js';
import * as monthly from '../src/modules/payroll/monthlyPayroll.service.js';
import * as payments from '../src/modules/payroll/payments.service.js';
import { writePayslipPdf } from '../src/modules/payroll/payslip.pdf.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

const { ActivityLog, EmployeeAdvance, Notification, PayPlan, PayrollAdjustment, PayrollItem, PayrollPayment, PayrollRun, Staff, User } = models;

let f;
let owner; // business owner at Andheri
let andheriOwner; // a branch owner who also covers Andheri

const now = DateTime.now().setZone('Asia/Kolkata');
const today = now.toISODate();
const lastMonth = now.minus({ months: 1 }).toFormat('yyyy-MM');
const thisMonth = now.toFormat('yyyy-MM');
const nextMonth = now.plus({ months: 1 }).toFormat('yyyy-MM');

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
  const [anita, meera] = await User.create([
    { orgId: f.ctxGlamour.orgId, role: 'OWNER', name: 'Anita', email: 'anita@g.com', passwordHash: 'x', allBranches: true },
    { orgId: f.ctxGlamour.orgId, role: 'OWNER', name: 'Meera', email: 'meera@g.com', passwordHash: 'x', branchIds: [f.andheri._id] },
  ]);
  owner = { ...f.ctxGlamour, userId: String(anita._id), userName: 'Anita', role: 'OWNER', isPrimaryOwner: true };
  andheriOwner = { ...f.ctxGlamour, userId: String(meera._id), userName: 'Meera', role: 'OWNER', isPrimaryOwner: false, allowedBranchIds: [String(f.andheri._id)] };
});
afterAll(stopDb);
beforeEach(async () => {
  await Promise.all([PayPlan, PayrollRun, PayrollItem, PayrollPayment, PayrollAdjustment, EmployeeAdvance, ActivityLog, Notification].map((m) => m.deleteMany({})));
  await Staff.updateOne({ _id: f.neha._id }, { status: 'active' });
});

const fixed = (rupees) => ({ model: 'FIXED', monthlyBase: rupees * 100, effectiveFrom: `${lastMonth}-01` });
let keyCount = 0;
const key = () => `test-key-${++keyCount}`;
const cash = (rupees, extra = {}) => ({ amount: rupees * 100, method: 'CASH', paidOn: today, ...extra });

// Rahul ₹20,000 and Neha ₹18,000 for last month, locked
async function lockedLastMonth() {
  await payroll.createPlan(owner, f.rahul._id, fixed(20000));
  await payroll.createPlan(owner, f.neha._id, fixed(18000));
  await monthly.lockRun(owner, lastMonth);
  const items = await PayrollItem.find({ month: lastMonth }).lean();
  return Object.fromEntries(items.map((i) => [i.staffName, i]));
}

describe('Advance repayment schedule', () => {
  const advance = { amount: 1000000, monthlyRepayment: 300000, firstMonth: '2026-11' };
  it('takes back a fixed amount each month, the last one smaller', () => {
    const months = ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02', '2027-03'];
    expect(months.map((m) => advanceRepayment(advance, m)?.amount ?? 0)).toEqual([0, 300000, 300000, 300000, 100000, 0]);
    expect(advanceRepayment(advance, '2027-02')).toMatchObject({ number: 4, count: 4 });
  });
  it('stops when closed', () => {
    expect(advanceRepayment({ ...advance, closedFromMonth: '2026-12' }, '2026-12')).toBeNull();
  });
});

describe('Salary payments', () => {
  it('only for a locked month', async () => {
    await payroll.createPlan(owner, f.rahul._id, fixed(20000));
    const { items } = await monthly.getRun(owner, lastMonth);
    await expect(payments.recordPayment(owner, items[0]._id, cash(1000), key())).rejects.toMatchObject({ code: 'NOT_LOCKED' });
  });

  it('part and full payments; never more than owed without the business owner', async () => {
    const { Rahul } = await lockedLastMonth();
    await payments.recordPayment(andheriOwner, Rahul._id, cash(5000), key());
    await payments.recordPayment(andheriOwner, Rahul._id, { amount: 1500000, method: 'UPI', reference: 'UPI123', paidOn: today }, key());

    await expect(payments.recordPayment(andheriOwner, Rahul._id, cash(1), key())).rejects.toMatchObject({ code: 'OVERPAYMENT', message: 'Rahul has already been paid in full for ' + DateTime.fromISO(`${lastMonth}-01`).toFormat('LLLL yyyy') + '.' });
    await expect(payments.recordPayment(andheriOwner, Rahul._id, cash(100, { allowOverpay: true, note: 'Tip' }), key())).rejects.toMatchObject({ status: 403 });

    const extra = await payments.recordPayment(owner, Rahul._id, cash(100, { allowOverpay: true, note: 'Festival tip agreed' }), key());
    expect(extra.overpaid).toBe(true);
    expect((await PayrollRun.findOne({ month: lastMonth }).lean()).paidTotal).toBe(2010000);

    // Paying is logged, and a branch owner's payment is sent to the business owner's bell
    expect(await ActivityLog.countDocuments({ action: 'payroll.payment_recorded' })).toBe(3);
    expect((await Notification.findOne({ userId: owner.userId }).sort({ createdAt: 1 }).lean()).message).toContain('Meera (Branch owner): Paid Rahul ₹5,000 by cash');
  });

  it('the same request twice records one payment', async () => {
    const { Neha } = await lockedLastMonth();
    const k = key();
    const [a, b] = await Promise.all([payments.recordPayment(owner, Neha._id, cash(1000), k), payments.recordPayment(owner, Neha._id, cash(1000), k)]);
    expect(String(a._id)).toBe(String(b._id));
    expect(await PayrollPayment.countDocuments()).toBe(1);
  });

  it('a cancelled payment no longer counts, and the record stays', async () => {
    const { Neha } = await lockedLastMonth();
    const payment = await payments.recordPayment(owner, Neha._id, cash(18000), key());
    await payments.cancelPayment(owner, payment._id, { reason: 'Entered twice by mistake' });
    expect(await PayrollPayment.findById(payment._id).lean()).toMatchObject({ status: 'cancelled', cancelReason: 'Entered twice by mistake' });
    await payments.recordPayment(owner, Neha._id, cash(18000), key()); // can be paid again
    await expect(payments.cancelPayment(owner, payment._id, { reason: 'again' })).rejects.toMatchObject({ code: 'ALREADY_CANCELLED' });
  });

  it('someone who has left is still in the payroll and can be paid', async () => {
    await payroll.createPlan(owner, f.rahul._id, fixed(20000));
    await payroll.createPlan(owner, f.neha._id, fixed(18000));
    await Staff.updateOne({ _id: f.neha._id }, { status: 'archived' });
    await monthly.lockRun(owner, lastMonth);
    const neha = await PayrollItem.findOne({ month: lastMonth, staffName: 'Neha' }).lean();
    expect(neha.net).toBe(1800000);
    await payments.recordPayment(owner, neha._id, cash(18000), key());
  });

  it('the next month shows salary still owed from earlier months', async () => {
    const { Rahul } = await lockedLastMonth();
    await payments.recordPayment(owner, Rahul._id, cash(20000), key());
    const { owedEarlier } = await monthly.getRun(owner, thisMonth);
    expect(owedEarlier).toEqual([{ month: lastMonth, owed: 1800000 }]); // Neha not paid yet
  });

  it('another salon can’t pay or see a payslip', async () => {
    const { Rahul } = await lockedLastMonth();
    const desert = { ...f.ctxDesert, userName: 'F', role: 'OWNER', isPrimaryOwner: true };
    await expect(payments.recordPayment(desert, Rahul._id, cash(1), key())).rejects.toMatchObject({ status: 404 });
    await expect(payments.getPayslip(desert, Rahul._id)).rejects.toMatchObject({ status: 404 });
  });
});

describe('Payslip', () => {
  it('is a PDF built from the locked amounts and payments', async () => {
    const { Rahul } = await lockedLastMonth();
    await payments.recordPayment(owner, Rahul._id, cash(5000), key());
    const data = await payments.getPayslip(owner, Rahul._id);
    expect(data.payments).toHaveLength(1);

    const stream = new PassThrough();
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    const done = new Promise((resolve) => stream.on('end', resolve));
    writePayslipPdf(stream, data);
    await done;
    expect(Buffer.concat(chunks).subarray(0, 4).toString()).toBe('%PDF');
  });
});

describe('Advances', () => {
  const advance = (extra = {}) => ({ amount: 600000, givenOn: today, method: 'CASH', reason: 'Family wedding', monthlyRepayment: 200000, firstMonth: thisMonth, ...extra });

  it('is taken back from pay each month until repaid or closed', async () => {
    await payroll.createPlan(owner, f.rahul._id, fixed(20000));
    const given = await payments.giveAdvance(owner, f.rahul._id, advance(), key());

    const { items } = await monthly.getRun(owner, thisMonth);
    const rahul = items.find((i) => i.staffName === 'Rahul');
    expect(rahul.lines.at(-1)).toMatchObject({ kind: 'advance', amount: 200000, detail: '1 of 3 · Family wedding' });
    expect(rahul.net).toBe(rahul.gross - 200000);

    await payments.closeAdvance(owner, given._id, { fromMonth: nextMonth, reason: 'Paid back the rest in cash' });
    expect(advanceRepayment(await EmployeeAdvance.findById(given._id).lean(), nextMonth)).toBeNull();
  });

  it('can’t start in a locked month; the same request twice gives one advance', async () => {
    await lockedLastMonth();
    await expect(payments.giveAdvance(owner, f.rahul._id, advance({ firstMonth: lastMonth, givenOn: `${lastMonth}-05` }), key())).rejects.toMatchObject({ code: 'MONTH_LOCKED' });
    const k = key();
    await payments.giveAdvance(owner, f.rahul._id, advance(), k);
    await payments.giveAdvance(owner, f.rahul._id, advance(), k);
    expect(await EmployeeAdvance.countDocuments()).toBe(1);
  });
});
