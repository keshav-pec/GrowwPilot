import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { Appointment, Attendance, Invoice, Payment } from '../src/models/index.js';
import { getAnalytics } from '../src/modules/analytics/analytics.service.js';
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
  await Payment.deleteMany({});
  await Attendance.deleteMany({});
});

// One haircut by `staff` at `branch`, starting at `start` (UTC)
function booking(branch, staff, start, minutes, status = 'COMPLETED') {
  const startAt = new Date(start);
  const endAt = new Date(+startAt + minutes * 60_000);
  return Appointment.create({
    orgId: f.ctxGlamour.orgId, branchId: branch._id, customerId: f.priya._id,
    customerSnapshot: { name: 'Priya', phone: '9876543210' },
    items: [{ serviceId: f.haircut._id, serviceName: 'Haircut', staffId: staff._id, staffName: staff.name, startAt, endAt, durationMinutes: minutes, price: 50000 }],
    startAt, endAt, totalPrice: 50000, status,
  });
}

describe('Analytics', () => {
  it('counts bookings, revenue, payment mix and busy times in branch time', async () => {
    const paid = await booking(f.andheri, f.rahul, '2026-10-01T05:00:00Z', 60); // Thu 1 Oct, 10:30 AM in Mumbai
    await booking(f.andheri, f.rahul, '2026-10-02T13:30:00Z', 45, 'BOOKED'); // Fri 2 Oct, 7:00 PM
    await booking(f.bandra, f.arjun, '2026-10-01T09:00:00Z', 60, 'CANCELLED'); // never counts
    const at = new Date('2026-10-01T06:00:00Z');
    await Invoice.create({
      orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, appointmentId: paid._id, customerId: f.priya._id, invoiceNumber: 'T-1', status: 'ISSUED', settlementStatus: 'PAID',
      lines: [{ name: 'Haircut', listUnitPrice: 50000, unitPrice: 50000 }], subtotal: 50000, taxableTotal: 50000, grandTotal: 50000, amountPaid: 50000, issuedAt: at, paidAt: at,
    });
    const payment = { orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, receivedAt: at, source: 'CHECKOUT' };
    await Payment.create([{ ...payment, method: 'CARD', amount: 30000 }, { ...payment, method: 'UPI', amount: 20000 }]);
    await Attendance.create({ orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, staffId: f.rahul._id, date: '2026-10-02', status: 'leave' });

    const report = await getAnalytics(f.ctxGlamour, { from: '2026-10-01', to: '2026-10-02', branchId: 'all' });
    expect(report.totals).toEqual({ revenue: 50000, collected: 50000, bookings: 2, invoices: 1, avgTicket: 50000 });
    expect(report.branchDemand.map((b) => [b.name, b.bookings])).toEqual([['Andheri', 2], ['Bandra', 0]]);
    expect(report.paymentMix.map((m) => [m.method, m.share])).toEqual([['CASH', 0], ['UPI', 40], ['CARD', 60], ['OTHER', 0]]);
    expect(report.slotDemand.slots.filter((s) => s.count > 0)).toEqual([{ day: 4, hour: 10, count: 1 }, { day: 5, hour: 19, count: 1 }]);
    // 105 booked minutes out of one working day (the other is leave) of 11 open hours
    expect(report.stylistDemand).toMatchObject([{ name: 'Rahul', bookings: 2, bookedMinutes: 105, serviceValue: 50000, utilisation: 16 }]);
  });

  it('shows bookings outside today’s opening hours instead of hiding them', async () => {
    await booking(f.andheri, f.neha, '2026-10-01T03:00:00Z', 30); // 8:30 AM in Mumbai, before the 10 AM opening
    const report = await getAnalytics(f.ctxGlamour, { from: '2026-10-01', to: '2026-10-01', branchId: String(f.andheri._id) });
    expect(report.slotDemand.hours[0]).toBe(8);
    expect(report.slotDemand.slots.filter((s) => s.count > 0)).toEqual([{ day: 4, hour: 8, count: 1 }]);
  });

  it('never shows another salon’s data, and refuses a branch outside the owner’s access', async () => {
    await booking(f.andheri, f.rahul, '2026-10-01T05:00:00Z', 60);
    const desert = await getAnalytics(f.ctxDesert, { from: '2026-10-01', to: '2026-10-01', branchId: 'all' });
    expect(desert.totals.bookings).toBe(0);
    await expect(getAnalytics(f.ctxDesert, { from: '2026-10-01', to: '2026-10-01', branchId: String(f.andheri._id) })).rejects.toMatchObject({ status: 404 });
  });
});
