import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DateTime } from 'luxon';
import { Appointment, Customer, Lead } from '../src/models/index.js';
import { convertLead, setLeadStatus } from '../src/modules/leads/leads.service.js';
import { bookWithLock } from '../src/modules/appointments/scheduling.service.js';
import { createFixtures, startDb, stopDb } from './testDb.js';

let f;
const tomorrow = () => DateTime.now().setZone('Asia/Kolkata').plus({ days: 1 }).toISODate();

beforeAll(async () => {
  await startDb();
  f = await createFixtures();
});
afterAll(stopDb);
beforeEach(async () => {
  await Appointment.deleteMany({});
  await Lead.deleteMany({});
  await Customer.deleteMany({ _id: { $ne: f.priya._id }, orgId: f.ctxGlamour.orgId });
});

const newLead = (phone, name = 'Meera') =>
  Lead.create({ orgId: f.ctxGlamour.orgId, branchId: f.andheri._id, name, phone, source: 'Instagram' });

const convert = (lead, startTime = '14:00') =>
  convertLead(f.ctxGlamour, lead._id, { date: tomorrow(), startTime, items: [{ serviceId: f.haircut._id, staffId: f.rahul._id }] });

describe('Convert lead to appointment', () => {
  it('creates the customer when the phone is new, books, and closes the lead', async () => {
    const lead = await newLead('9811100001');
    const result = await convert(lead);

    expect(result.isExistingCustomer).toBe(false);
    expect(result.customer).toMatchObject({ name: 'Meera', phone: '9811100001' });
    expect(result.appointment).toMatchObject({ source: 'lead', status: 'BOOKED' });
    expect(String(result.appointment.leadId)).toBe(String(lead._id));

    const saved = await Lead.findById(lead._id);
    expect(saved.status).toBe('APPOINTMENT_BOOKED');
    expect(String(saved.customerId)).toBe(String(result.customer._id));
    expect(String(saved.appointmentId)).toBe(String(result.appointment._id));
  });

  it('links to the existing customer when the phone already exists (no duplicate)', async () => {
    const lead = await newLead('+91 98765 43210', 'Priya S'); // same phone as Priya, typed differently
    const result = await convert(lead);

    expect(result.isExistingCustomer).toBe(true);
    expect(String(result.customer._id)).toBe(String(f.priya._id));
    expect(await Customer.countDocuments({ orgId: f.ctxGlamour.orgId, phone: '9876543210' })).toBe(1);
  });

  it('saves NOTHING when the slot is taken (no customer, no booking, lead unchanged)', async () => {
    await bookWithLock(f.ctxGlamour, { branchId: f.andheri._id, customerId: f.priya._id, date: tomorrow(), startTime: '14:00', items: [{ serviceId: f.haircut._id, staffId: f.rahul._id }] });
    const lead = await newLead('9811100002');

    await expect(convert(lead, '14:30')).rejects.toMatchObject({ status: 409, code: 'SLOT_TAKEN' });

    expect(await Customer.exists({ phone: '9811100002' })).toBeNull(); // the new customer was rolled back
    expect(await Appointment.countDocuments({ leadId: lead._id })).toBe(0);
    expect((await Lead.findById(lead._id)).status).toBe('NEW');
  });

  it("can't convert a lead twice", async () => {
    const lead = await newLead('9811100003');
    await convert(lead, '10:00');
    await expect(convert(lead, '16:00')).rejects.toMatchObject({ status: 409, code: 'LEAD_CLOSED' });
  });
});

describe('Lead status changes', () => {
  it('moves forward and blocks "Appointment booked" outside the convert flow', async () => {
    const lead = await newLead('9811100004');
    await expect(setLeadStatus(f.ctxGlamour, lead._id, 'INTERESTED')).resolves.toMatchObject({ status: 'INTERESTED' });
    await expect(setLeadStatus(f.ctxGlamour, lead._id, 'NEW')).rejects.toMatchObject({ code: 'INVALID_STATUS_CHANGE' });
    await expect(setLeadStatus(f.ctxGlamour, lead._id, 'APPOINTMENT_BOOKED')).rejects.toMatchObject({ code: 'INVALID_STATUS_CHANGE' });
  });
});
