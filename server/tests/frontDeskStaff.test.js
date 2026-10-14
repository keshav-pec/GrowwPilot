import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Appointment, Staff, User } from '../src/models/index.js';
import { createStaff, findServiceStaff, updateStaff } from '../src/modules/staff/staff.service.js';
import { bookWithLock, getAvailability } from '../src/modules/appointments/scheduling.service.js';
import { createCustomer } from '../src/modules/customers/customers.service.js';
import { listStaffPay } from '../src/modules/payroll/payroll.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

let f;
let ctx; // the business owner, working in Andheri
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
});
afterAll(stopDb);
beforeEach(async () => {
  await Appointment.deleteMany({});
  await Staff.deleteMany({ kind: 'FRONT_DESK' });
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

describe('Payroll leaves front desk members out (until Part 6)', () => {
  it('does not list them in pay setup and hides their pay page', async () => {
    const member = await addDesk();
    const { rows } = await listStaffPay(ctx);
    expect(rows.some((r) => String(r.staff._id) === String(member._id))).toBe(false);
    expect(rows.some((r) => String(r.staff._id) === String(f.rahul._id))).toBe(true);
    await expect(findServiceStaff(ctx, member._id)).rejects.toMatchObject({ status: 404 });
  });
});
