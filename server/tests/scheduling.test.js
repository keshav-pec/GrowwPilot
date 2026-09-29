import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Appointment, Attendance } from '../src/models/index.js';
import { bookWithLock, getAvailability } from '../src/modules/appointments/scheduling.service.js';
import { dayRangeUTC, localToUTC } from '../src/utils/time.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

let f; // test data (salons, branches, staff, services...)
const tomorrowIn = (zone) => DateTime.now().setZone(zone).plus({ days: 1 }).toISODate();
const INDIA = 'Asia/Kolkata';

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
});
afterAll(stopDb);
beforeEach(async () => {
  await Appointment.deleteMany({});
  await Attendance.deleteMany({});
});

// Book at Glamour's Andheri branch tomorrow. Default: Haircut (45 min) with Rahul at 2:00 PM.
function book({ startTime = '14:00', items, ...rest } = {}) {
  return bookWithLock(f.ctxGlamour, {
    branchId: f.andheri._id,
    customerId: f.priya._id,
    date: tomorrowIn(INDIA),
    startTime,
    items: items ?? [{ serviceId: f.haircut._id, staffId: f.rahul._id }],
    ...rest,
  });
}

// Checks that a promise fails with our AppError { status, code }
async function expectError(promise, status, code) {
  await expect(promise).rejects.toMatchObject({ status, code });
}

describe('Overlap rule', () => {
  it('blocks 2:30 PM when Rahul is already booked 2:00–2:45 PM (example from the PDF)', async () => {
    await book({ startTime: '14:00' });
    await expect(book({ startTime: '14:30' })).rejects.toMatchObject({
      status: 409,
      code: 'SLOT_TAKEN',
      message: 'Rahul is already booked from 2:00 PM to 2:45 PM',
    });
  });

  it('allows back-to-back bookings (one ends at 2:45, the next starts at 2:45)', async () => {
    await book({ startTime: '14:00' });
    await expect(book({ startTime: '14:45' })).resolves.toBeDefined(); // starts right when the other ends
    await expect(book({ startTime: '13:15' })).resolves.toBeDefined(); // ends right when the other starts
  });

  it('lets a different stylist take the same time', async () => {
    await book({ startTime: '14:00' });
    await expect(book({ startTime: '14:00', items: [{ serviceId: f.haircut._id, staffId: f.neha._id }] })).resolves.toBeDefined();
  });

  it('ignores cancelled bookings', async () => {
    const first = await book({ startTime: '14:00' });
    await Appointment.updateOne({ _id: first._id }, { status: 'CANCELLED' });
    await expect(book({ startTime: '14:00' })).resolves.toBeDefined();
  });

  it("catches a clash on the booking's second service", async () => {
    await book({ startTime: '14:00' }); // Rahul 2:00–2:45
    // Haircut with Neha 1:00–1:45, then Beard Trim with Rahul 1:45–2:15 -> clashes with Rahul's 2:00
    const items = [
      { serviceId: f.haircut._id, staffId: f.neha._id },
      { serviceId: f.beardTrim._id, staffId: f.rahul._id },
    ];
    await expectError(book({ startTime: '13:00', items }), 409, 'SLOT_TAKEN');
  });
});

describe('Two desks booking at the same moment', () => {
  it('saves exactly one of two simultaneous bookings for the same slot', async () => {
    const results = await Promise.allSettled([book({ startTime: '16:00' }), book({ startTime: '16:00' })]);

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toMatchObject({ status: 409, code: 'SLOT_TAKEN' });
    expect(await Appointment.countDocuments()).toBe(1);
  });

  it('saves exactly one of five simultaneous overlapping bookings', async () => {
    // Every pair of these overlaps (all start within 30 min of each other, each haircut is 45 min)
    const times = ['16:00', '16:15', '16:00', '16:30', '16:20'];
    const results = await Promise.allSettled(times.map((startTime) => book({ startTime })));

    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await Appointment.countDocuments()).toBe(1);
  });
});

describe('Building the appointment', () => {
  it('chains services back to back and uses the branch default when a service has no duration', async () => {
    const items = [
      { serviceId: f.haircut._id, staffId: f.rahul._id },
      { serviceId: f.beardTrim._id, staffId: f.rahul._id },
    ];
    const appt = await book({ startTime: '11:00', items });
    const local = (d) => DateTime.fromJSDate(d, { zone: INDIA }).toFormat('HH:mm');

    expect(appt.items.map((i) => [local(i.startAt), local(i.endAt), i.durationMinutes])).toEqual([
      ['11:00', '11:45', 45],
      ['11:45', '12:15', 30], // Beard Trim has no duration -> Andheri default 30 min
    ]);
    expect(local(appt.startAt)).toBe('11:00');
    expect(local(appt.endAt)).toBe('12:15');
    expect(appt.totalPrice).toBe(70000); // ₹500 + ₹200
  });

  it('uses the duration typed by the front desk', async () => {
    const appt = await book({ items: [{ serviceId: f.beardTrim._id, staffId: f.rahul._id, durationMinutes: 20 }] });
    expect(appt.items[0].durationMinutes).toBe(20);
  });

  it('copies names and prices into the appointment (snapshot)', async () => {
    const appt = await book();
    expect(appt.items[0]).toMatchObject({ serviceName: 'Haircut', staffName: 'Rahul', price: 50000 });
    expect(appt.customerSnapshot).toMatchObject({ name: 'Priya', phone: '9876543210' });
    expect(appt.statusHistory[0].to).toBe('BOOKED');
  });

  it('uses the combo price for a combo', async () => {
    const items = [
      { serviceId: f.haircut._id, staffId: f.rahul._id },
      { serviceId: f.beardTrim._id, staffId: f.rahul._id },
    ];
    const appt = await book({ items, comboId: f.combo._id });
    expect(appt.totalPrice).toBe(60000); // combo ₹600 instead of ₹700
  });

  it("rejects a combo whose services don't match", async () => {
    await expectError(book({ comboId: f.combo._id }), 400, 'INVALID_COMBO'); // only Haircut
  });
});

describe('Booking rules', () => {
  it('must fit inside opening hours (Andheri: 10 AM to 9 PM)', async () => {
    await expectError(book({ startTime: '20:30' }), 400, 'OUTSIDE_HOURS'); // would end 9:15 PM
    await expectError(book({ startTime: '09:30' }), 400, 'OUTSIDE_HOURS');
    await expect(book({ startTime: '20:15' })).resolves.toBeDefined(); // ends exactly 9:00 PM
  });

  it('refuses inactive staff, staff from another branch, and absent staff', async () => {
    await expectError(book({ items: [{ serviceId: f.haircut._id, staffId: f.ravi._id }] }), 400, 'STAFF_UNAVAILABLE');
    await expectError(book({ items: [{ serviceId: f.haircut._id, staffId: f.arjun._id }] }), 400, 'STAFF_UNAVAILABLE');

    await Attendance.create({ orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, staffId: f.rahul._id, date: tomorrowIn(INDIA), status: 'absent' });
    await expectError(book(), 400, 'STAFF_UNAVAILABLE');
  });

  it('refuses a service not offered at this branch', async () => {
    await expectError(book({ items: [{ serviceId: f.facial._id, staffId: f.rahul._id }] }), 400, 'INVALID_SERVICE');
  });

  it("refuses another salon's stylist, service, customer or branch", async () => {
    await expectError(book({ items: [{ serviceId: f.haircut._id, staffId: f.omar._id }] }), 400, 'INVALID_STAFF');
    await expectError(book({ items: [{ serviceId: f.dubaiHaircut._id, staffId: f.rahul._id }] }), 400, 'INVALID_SERVICE');
    await expectError(book({ customerId: f.fatima._id }), 404, 'NOT_FOUND');
    await expectError(book({ branchId: f.marina._id }), 404, 'NOT_FOUND');
  });

  it('refuses a time in the past', async () => {
    const yesterday = DateTime.now().setZone(INDIA).minus({ days: 1 }).toISODate();
    await expectError(book({ date: yesterday }), 400, 'PAST_TIME');
  });
});

describe('Timezones: Kolkata vs Dubai', () => {
  it('converts branch local time to UTC', () => {
    expect(localToUTC('2026-09-28', '14:30', 'Asia/Kolkata').toISOString()).toBe('2026-09-28T09:00:00.000Z'); // UTC+5:30
    expect(localToUTC('2026-09-28', '14:30', 'Asia/Dubai').toISOString()).toBe('2026-09-28T10:30:00.000Z'); // UTC+4
  });

  it('gives each branch its own "day"', () => {
    const { start, end } = dayRangeUTC('2026-09-28', 'Asia/Kolkata');
    expect([start.toISOString(), end.toISOString()]).toEqual(['2026-09-27T18:30:00.000Z', '2026-09-28T18:30:00.000Z']);
  });

  it('stores the same 2:30 PM differently for a Kolkata and a Dubai branch', async () => {
    const kolkata = await book({ startTime: '14:30' });
    const dubaiDate = tomorrowIn('Asia/Dubai');
    const dubai = await bookWithLock(f.ctxDesert, {
      branchId: f.marina._id,
      customerId: f.fatima._id,
      date: dubaiDate,
      startTime: '14:30',
      items: [{ serviceId: f.dubaiHaircut._id, staffId: f.omar._id }],
    });

    expect(kolkata.startAt.toISOString()).toBe(`${tomorrowIn(INDIA)}T09:00:00.000Z`);
    expect(dubai.startAt.toISOString()).toBe(`${dubaiDate}T10:30:00.000Z`);
  });

  it('checks opening hours in the branch’s own time (Dubai opens 9 AM Dubai time)', async () => {
    const dubai = (startTime) =>
      bookWithLock(f.ctxDesert, {
        branchId: f.marina._id,
        customerId: f.fatima._id,
        date: tomorrowIn('Asia/Dubai'),
        startTime,
        items: [{ serviceId: f.dubaiHaircut._id, staffId: f.omar._id }],
      });
    await expectError(dubai('08:45'), 400, 'OUTSIDE_HOURS');
    await expect(dubai('09:00')).resolves.toBeDefined();
  });
});

describe('Availability (free start times)', () => {
  it("leaves out the times that would clash with Rahul's 2:00–2:45 booking", async () => {
    await book({ startTime: '14:00' });
    const { slots } = await getAvailability(f.ctxGlamour, { date: tomorrowIn(INDIA), staffId: String(f.rahul._id), duration: 45 });

    expect(slots[0]).toBe('10:00'); // opening time
    expect(slots.at(-1)).toBe('20:15'); // last 45-min slot that ends by 9 PM
    expect(slots).toContain('13:15'); // ends at 2:00
    expect(slots).not.toContain('13:30'); // would run into 2:00
    expect(slots).not.toContain('14:00');
    expect(slots).not.toContain('14:30');
    expect(slots).toContain('14:45'); // starts when the booking ends
  });

  it('returns no times for a stylist marked absent', async () => {
    await Attendance.create({ orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, staffId: f.rahul._id, date: tomorrowIn(INDIA), status: 'leave' });
    const result = await getAvailability(f.ctxGlamour, { date: tomorrowIn(INDIA), staffId: String(f.rahul._id) });
    expect(result.slots).toEqual([]);
    expect(result.reason).toBe('Rahul is marked leave on this day');
  });

  it('lists Dubai times in Dubai time', async () => {
    const { slots, timezone } = await getAvailability(f.ctxDesert, { date: tomorrowIn('Asia/Dubai'), staffId: String(f.omar._id), duration: 30 });
    expect(timezone).toBe('Asia/Dubai');
    expect(slots[0]).toBe('09:00');
    expect(slots.at(-1)).toBe('21:30');
  });
});
