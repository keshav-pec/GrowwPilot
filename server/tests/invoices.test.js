import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Appointment, Counter, Invoice } from '../src/models/index.js';
import { calculateCheckout, createInvoice } from '../src/modules/invoices/invoices.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

let f;
beforeAll(async () => {
  await startDb();
  f = await createFixtures();
});
afterAll(stopDb);
beforeEach(async () => {
  await Appointment.deleteMany({});
  await Invoice.deleteMany({});
  await Counter.deleteMany({});
});

// A finished ₹1,530 appointment, ready for checkout
function completedAppointment(status = 'COMPLETED', totalPrice = 153000) {
  const start = new Date();
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, customerId: f.priya._id,
    customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: f.rahul._id, staffName: 'Rahul', startAt: start, endAt: start, durationMinutes: 45, price: totalPrice }],
    startAt: start, endAt: start, totalPrice, status,
  });
}

const pay = (appointment, payments, discount = {}) =>
  createInvoice(f.ctxGlamour, { appointmentId: appointment._id, discountType: 'flat', discountValue: 0, payments, ...discount });

describe('Checkout money rules (plan 4.5)', () => {
  it('accepts ₹1,530 paid as ₹1,000 card + ₹500 UPI + ₹30 cash', async () => {
    const appt = await completedAppointment();
    const invoice = await pay(appt, [
      { method: 'CARD', amount: 100000 },
      { method: 'UPI', amount: 50000, reference: 'UPI123' },
      { method: 'CASH', amount: 3000 },
    ]);
    expect(invoice).toMatchObject({ subtotal: 153000, discount: 0, total: 153000 });
    expect(invoice.payments.map((p) => p.method)).toEqual(['CARD', 'UPI', 'CASH']);
    expect(invoice.lines[0]).toMatchObject({ serviceName: 'Haircut', staffName: 'Rahul', price: 153000 });
    expect(String((await Appointment.findById(appt._id)).invoiceId)).toBe(String(invoice._id));
  });

  it('rejects ₹1,000 + ₹500 (₹30 short)', async () => {
    const appt = await completedAppointment();
    await expect(pay(appt, [{ method: 'CARD', amount: 100000 }, { method: 'UPI', amount: 50000 }])).rejects.toMatchObject({
      status: 400,
      code: 'PAYMENT_MISMATCH',
      message: 'Payments are ₹30.00 short of the total ₹1,530.00',
    });
    expect(await Invoice.countDocuments()).toBe(0);
  });

  it('rejects paying more than the total', () => {
    expect(() => calculateCheckout(153000, { discountType: 'flat', discountValue: 0, payments: [{ amount: 160000 }] })).toThrow('more than the total');
  });

  it('rejects a discount bigger than the bill, so the total can never go negative', async () => {
    const appt = await completedAppointment();
    await expect(pay(appt, [], { discountValue: 200000 })).rejects.toMatchObject({ code: 'INVALID_DISCOUNT' });
    expect(() => calculateCheckout(153000, { discountType: 'percent', discountValue: 120, payments: [] })).toThrow('at most 100%');
  });

  it('applies a flat or percentage discount', () => {
    expect(calculateCheckout(153000, { discountType: 'flat', discountValue: 3000, payments: [{ amount: 150000 }] })).toEqual({ discount: 3000, total: 150000 });
    expect(calculateCheckout(153000, { discountType: 'percent', discountValue: 10, payments: [{ amount: 137700 }] })).toEqual({ discount: 15300, total: 137700 });
    expect(calculateCheckout(153000, { discountType: 'percent', discountValue: 100, payments: [] })).toEqual({ discount: 153000, total: 0 }); // free
  });

  it('uses the price from the database, whatever the client might want', async () => {
    const appt = await completedAppointment('COMPLETED', 50000);
    // There is no price field in the request at all; paying ₹1 for a ₹500 service fails
    await expect(pay(appt, [{ method: 'CASH', amount: 100 }])).rejects.toMatchObject({ code: 'PAYMENT_MISMATCH' });
  });
});

describe('Paying only once', () => {
  it('rejects checking out the same appointment twice', async () => {
    const appt = await completedAppointment();
    await pay(appt, [{ method: 'CASH', amount: 153000 }]);
    await expect(pay(appt, [{ method: 'CASH', amount: 153000 }])).rejects.toMatchObject({ status: 409, code: 'ALREADY_PAID' });
  });

  it('when two desks check out at the same moment, only one invoice is saved', async () => {
    const appt = await completedAppointment();
    const results = await Promise.allSettled([pay(appt, [{ method: 'CASH', amount: 153000 }]), pay(appt, [{ method: 'UPI', amount: 153000 }])]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Invoice.countDocuments({ appointmentId: appt._id })).toBe(1);
  });

  it('only checks out completed appointments', async () => {
    const appt = await completedAppointment('IN_SERVICE');
    await expect(pay(appt, [{ method: 'CASH', amount: 153000 }])).rejects.toMatchObject({ code: 'NOT_COMPLETED' });
  });
});

describe('Invoice numbers', () => {
  it('counts up per branch: GP-AND-000001, GP-AND-000002', async () => {
    const first = await pay(await completedAppointment(), [{ method: 'CASH', amount: 153000 }]);
    const second = await pay(await completedAppointment(), [{ method: 'CASH', amount: 153000 }]);
    expect([first.invoiceNumber, second.invoiceNumber]).toEqual(['GP-AND-000001', 'GP-AND-000002']);
  });

  it("doesn't use up a number when checkout fails", async () => {
    const appt = await completedAppointment();
    await pay(appt, [{ method: 'CASH', amount: 153000 }]);
    await expect(pay(appt, [{ method: 'CASH', amount: 153000 }])).rejects.toBeDefined();
    const next = await pay(await completedAppointment(), [{ method: 'CASH', amount: 153000 }]);
    expect(next.invoiceNumber).toBe('GP-AND-000002');
  });
});
