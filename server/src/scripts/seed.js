// Wipes the database and fills it with a realistic demo: 2 salons, 3 branches, staff, services,
// combos, customers, leads, 4 weeks of appointment history with invoices, a busy "today", payroll,
// and the Inventory add-on for Glamour Studio's Andheri branch (Bandra is left to show the setup guide).
// Today's appointments are placed around the CURRENT time, so the day board and dashboard always look alive.
//
// Run with: npm run seed        (refuses to run in production unless you add -- --force)
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import { toPaise } from '../utils/money.js';
import { hashPassword } from '../utils/password.js';
import * as models from '../models/index.js';
import * as payroll from '../modules/payroll/payroll.service.js';
import * as monthlyPayroll from '../modules/payroll/monthlyPayroll.service.js';
import * as salaryPayments from '../modules/payroll/payments.service.js';
import { createLocation } from '../modules/inventory/locations/locations.service.js';
import { createSupplier } from '../modules/inventory/suppliers/suppliers.service.js';
import { createSku } from '../modules/inventory/skus/skus.service.js';
import { saveRecipe } from '../modules/inventory/recipes/recipes.service.js';
import { finish, issue } from '../modules/inventory/allocations/allocations.service.js';
import { writeOff } from '../modules/inventory/movements/movements.service.js';
import { reportProblem } from '../modules/inventory/approvals/approvals.service.js';
import { createOrder, moveOrder, receiveOrder, submitOrder } from '../modules/inventory/purchasing/purchasing.service.js';
import { markSetupStep } from '../modules/inventory/setup/setup.service.js';
import { addImages } from '../modules/inventory/images/images.service.js';
import { migrateBilling } from './migrate-billing-v2.js';
import { gstinCheckChar } from '../config/billing.js';
import sharp from 'sharp';
import { DESERT_ROSE_CUSTOMERS, DESERT_ROSE_SERVICES, GLAMOUR_CUSTOMERS, GLAMOUR_SERVICES, LEADS } from './seed-data.js';

const { Organization, Branch, User, Staff, Service, Combo, Customer, Appointment, Invoice, Lead, Attendance, Counter } = models;
const { ObjectId } = mongoose.Types;
const DEMO_PASSWORD = 'Password@123';

// Safety check: never wipe the production database by accident
if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to seed in production. Run "npm run seed -- --force" if you really mean it.');
  process.exit(1);
}

await connectDB();
await mongoose.connection.dropDatabase();
await Promise.all(Object.values(models).map((model) => model.syncIndexes()));
console.log('Database wiped and indexes created');

const passwordHash = await hashPassword(DEMO_PASSWORD);
const byName = (docs) => Object.fromEntries(docs.map((d) => [d.name, d]));

// ===========================================================================
// 1. Salons, branches, logins, staff, services, combos, customers
// ===========================================================================
await User.create({ role: 'SUPER_ADMIN', name: 'GrowwPilot Admin', email: 'admin@growwpilot.com', passwordHash });

const glamour = await Organization.create({ name: 'Glamour Studio', slug: 'glamour-studio', ownerName: 'Anita Mehra', contactEmail: 'owner@glamour.com', contactPhone: '9820012345', city: 'Mumbai', plan: 'pro' });
const desertRose = await Organization.create({ name: 'Desert Rose Salon', slug: 'desert-rose', ownerName: 'Fatima Khan', contactEmail: 'owner@desertrose.com', city: 'Dubai', plan: 'basic' });

const branch = byName(
  await Branch.create([
    { orgId: glamour._id, name: 'Andheri', address: 'Lokhandwala Market, Andheri West', city: 'Mumbai', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00' },
    { orgId: glamour._id, name: 'Bandra', address: 'Hill Road, Bandra West', city: 'Mumbai', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '20:00' },
    { orgId: desertRose._id, name: 'Dubai Marina', address: 'Marina Walk', city: 'Dubai', timezone: 'Asia/Dubai', openTime: '09:00', closeTime: '22:00' },
  ])
);

const users = await User.create([
  { orgId: glamour._id, role: 'OWNER', name: 'Anita Mehra', email: 'owner@glamour.com', passwordHash, allBranches: true },
  { orgId: glamour._id, role: 'OWNER', name: 'Vikram Shah', email: 'bandra.owner@glamour.com', passwordHash, branchIds: [branch.Bandra._id] }, // branch owner
  { orgId: glamour._id, role: 'FRONT_DESK', name: 'Kavya (Andheri desk)', email: 'desk.andheri@glamour.com', passwordHash, branchIds: [branch.Andheri._id] },
  { orgId: glamour._id, role: 'FRONT_DESK', name: 'Ritu (Bandra desk)', email: 'desk.bandra@glamour.com', passwordHash, branchIds: [branch.Bandra._id] },
  { orgId: desertRose._id, role: 'OWNER', name: 'Fatima Khan', email: 'owner@desertrose.com', passwordHash, allBranches: true },
  { orgId: desertRose._id, role: 'FRONT_DESK', name: 'Maya (Marina desk)', email: 'desk@desertrose.com', passwordHash, branchIds: [branch['Dubai Marina']._id] },
]);
// The front desk user of each branch (they "created" that branch's bookings)
const deskOf = { Andheri: users[2], Bandra: users[3], 'Dubai Marina': users[5] };

const staff = byName(
  await Staff.create([
    { orgId: glamour._id, branchId: branch.Andheri._id, name: 'Rahul', role: 'Senior Stylist', phone: '9811111111' },
    { orgId: glamour._id, branchId: branch.Andheri._id, name: 'Neha', role: 'Beautician', phone: '9822222222' },
    { orgId: glamour._id, branchId: branch.Andheri._id, name: 'Kabir', role: 'Barber', phone: '9833333333' },
    { orgId: glamour._id, branchId: branch.Bandra._id, name: 'Arjun', role: 'Stylist', phone: '9844444444' },
    { orgId: glamour._id, branchId: branch.Bandra._id, name: 'Zoya', role: 'Nail Artist', phone: '9855555555' },
    { orgId: desertRose._id, branchId: branch['Dubai Marina']._id, name: 'Omar', role: 'Barber' },
    { orgId: desertRose._id, branchId: branch['Dubai Marina']._id, name: 'Layla', role: 'Stylist' },
    { orgId: desertRose._id, branchId: branch['Dubai Marina']._id, name: 'Hana', role: 'Beautician' },
    // Front desk members: paid like everyone else, never booked, linked to their login
    { orgId: glamour._id, branchId: branch.Andheri._id, name: 'Kavya', kind: 'FRONT_DESK', role: 'Receptionist', userId: deskOf.Andheri._id },
    { orgId: glamour._id, branchId: branch.Bandra._id, name: 'Ritu', kind: 'FRONT_DESK', role: 'Receptionist', userId: deskOf.Bandra._id },
  ])
);

const serviceDocs = (org, rows) =>
  rows.map(([name, category, minutes, rupees, branches]) => ({
    orgId: org._id,
    name,
    category,
    durationMinutes: minutes ?? undefined,
    price: toPaise(rupees),
    branchIds: branches.map((b) => branch[b]._id),
  }));
const gs = byName(await Service.create(serviceDocs(glamour, GLAMOUR_SERVICES))); // Glamour services
const ds = byName(await Service.create(serviceDocs(desertRose, DESERT_ROSE_SERVICES))); // Desert Rose services

const combo = byName(
  await Combo.create([
    { orgId: glamour._id, name: 'Haircut + Beard Trim', serviceIds: [gs.Haircut._id, gs['Beard Trim']._id], comboPrice: toPaise(600) },
    { orgId: glamour._id, name: 'Mani + Pedi', serviceIds: [gs.Manicure._id, gs.Pedicure._id], comboPrice: toPaise(1300), branchIds: [branch.Bandra._id] },
  ])
);

const glamourCustomers = await Customer.create(GLAMOUR_CUSTOMERS.map(([name, phone]) => ({ orgId: glamour._id, name, phone })));
const desertCustomers = await Customer.create(DESERT_ROSE_CUSTOMERS.map(([name, phone]) => ({ orgId: desertRose._id, name, phone })));
const gc = byName(glamourCustomers);

// Hand out customers in turn, so everyone gets some history
let gi = 0;
let di = 0;
const nextGlamourCustomer = () => glamourCustomers[gi++ % glamourCustomers.length];
const nextDesertCustomer = () => desertCustomers[di++ % desertCustomers.length];

// ===========================================================================
// 2. Appointments (built in memory first, then saved in one go)
// ===========================================================================
const appointments = [];
const toBePaid = []; // { appointment, method, discountPercent?, split? }

// Status history that matches the final status (Booked -> Arrived -> In service -> Completed, or Cancelled)
function historyFor(status, start, end, by) {
  const history = [{ to: 'BOOKED', by, at: start.minus({ days: 2 }).toJSDate() }];
  const steps = { ARRIVED: ['ARRIVED'], IN_SERVICE: ['ARRIVED', 'IN_SERVICE'], COMPLETED: ['ARRIVED', 'IN_SERVICE', 'COMPLETED'] }[status] ?? [];
  const when = { ARRIVED: start.minus({ minutes: 5 }), IN_SERVICE: start, COMPLETED: end };
  let from = 'BOOKED';
  for (const to of steps) {
    history.push({ from, to, by, at: when[to].toJSDate() });
    from = to;
  }
  if (status === 'CANCELLED') history.push({ from: 'BOOKED', to: 'CANCELLED', by, at: start.minus({ days: 1 }).toJSDate(), reason: 'Customer asked to cancel' });
  return history;
}

// Same shape a real booking has: items back to back, with name / price / stylist snapshots
function addAppointment({ salon, branchName, customer, start, lines, status = 'BOOKED', comboDoc, source = 'phone', leadId, pay }) {
  const b = branch[branchName];
  const desk = deskOf[branchName];
  let cursor = start;
  const items = lines.map(([service, stylist]) => {
    const minutes = service.durationMinutes ?? b.defaultServiceMinutes;
    const item = { _id: new ObjectId(), serviceId: service._id, serviceName: service.name, staffId: stylist._id, staffName: stylist.name, startAt: cursor.toJSDate(), endAt: cursor.plus({ minutes }).toJSDate(), durationMinutes: minutes, price: service.price };
    cursor = cursor.plus({ minutes });
    return item;
  });
  const appointment = {
    _id: new ObjectId(),
    orgId: salon._id,
    branchId: b._id,
    customerId: customer._id,
    customerSnapshot: { name: customer.name, phone: customer.phone },
    items,
    comboId: comboDoc?._id,
    startAt: start.toJSDate(),
    endAt: cursor.toJSDate(),
    totalPrice: comboDoc ? comboDoc.comboPrice : items.reduce((sum, i) => sum + i.price, 0),
    status,
    statusHistory: historyFor(status, start, cursor, desk._id),
    source,
    leadId,
    createdBy: desk._id,
  };
  appointments.push(appointment);
  if (pay) toBePaid.push({ appointment, ...pay });
  return appointment;
}

// A time at a branch: `days` from today (negative = past), at "HH:mm"
const at = (branchName, days, time) => {
  const [h, m] = time.split(':').map(Number);
  return DateTime.now().setZone(branch[branchName].timezone).startOf('day').plus({ days }).set({ hour: h, minute: m });
};

// "Now" at a branch, kept inside opening hours so today's bookings always fit on the day board
function anchor(branchName) {
  const b = branch[branchName];
  const now = DateTime.now().setZone(b.timezone).startOf('minute');
  const earliest = at(branchName, 0, b.openTime).plus({ minutes: 150 });
  const latest = at(branchName, 0, b.closeTime).minus({ minutes: 150 });
  const t = now < earliest ? earliest : now > latest ? latest : now;
  return t.minus({ minutes: t.minute % 5 }); // round to 5 minutes
}

const PAY_METHODS = ['CASH', 'UPI', 'CARD'];

// ----- 2a. Four weeks of history (for analytics, customer profiles and "revenue vs usual") -----
for (let d = 1; d <= 28; d++) {
  const past = -d;
  // Andheri: Rahul every day, Neha every other day, Kabir sometimes, one cancellation now and then
  addAppointment({
    salon: glamour, branchName: 'Andheri', customer: nextGlamourCustomer(), start: at('Andheri', past, '11:00'),
    lines: [[d % 2 ? gs.Haircut : gs['Hair Colour'], staff.Rahul]], status: 'COMPLETED',
    pay: { method: PAY_METHODS[d % 3], discountPercent: d % 7 === 0 ? 10 : 0, split: d % 5 === 0 },
  });
  if (d % 2 === 0) addAppointment({ salon: glamour, branchName: 'Andheri', customer: nextGlamourCustomer(), start: at('Andheri', past, '15:00'), lines: [[gs.Facial, staff.Neha]], status: 'COMPLETED', pay: { method: 'UPI' } });
  if (d % 4 === 1) addAppointment({ salon: glamour, branchName: 'Andheri', customer: nextGlamourCustomer(), start: at('Andheri', past, '13:00'), lines: [[gs.Haircut, staff.Kabir], [gs['Beard Trim'], staff.Kabir]], comboDoc: combo['Haircut + Beard Trim'], status: 'COMPLETED', pay: { method: 'CASH' } });
  if (d % 6 === 0) addAppointment({ salon: glamour, branchName: 'Andheri', customer: nextGlamourCustomer(), start: at('Andheri', past, '17:00'), lines: [[gs['Beard Trim'], staff.Kabir]], status: 'CANCELLED' });

  // Bandra: a two-service booking and the Mani + Pedi combo
  if (d % 3 === 0) addAppointment({ salon: glamour, branchName: 'Bandra', customer: nextGlamourCustomer(), start: at('Bandra', past, '13:00'), lines: [[gs.Haircut, staff.Arjun], [gs['Hair Spa'], staff.Arjun]], status: 'COMPLETED', pay: { method: 'CARD', split: d % 2 === 0 } });
  if (d % 4 === 0) addAppointment({ salon: glamour, branchName: 'Bandra', customer: nextGlamourCustomer(), start: at('Bandra', past, '16:00'), lines: [[gs.Manicure, staff.Zoya], [gs.Pedicure, staff.Zoya]], comboDoc: combo['Mani + Pedi'], status: 'COMPLETED', pay: { method: 'UPI' } });

  // Dubai Marina
  if (d % 3 === 1) addAppointment({ salon: desertRose, branchName: 'Dubai Marina', customer: nextDesertCustomer(), start: at('Dubai Marina', past, '18:00'), lines: [[ds.Haircut, staff.Omar]], status: 'COMPLETED', pay: { method: 'CARD' } });
  if (d % 5 === 2) addAppointment({ salon: desertRose, branchName: 'Dubai Marina', customer: nextDesertCustomer(), start: at('Dubai Marina', past, '12:00'), lines: [[ds['Blow Dry'], staff.Layla]], status: 'COMPLETED', pay: { method: 'CASH' } });
}

// A past booking that came from a lead (Rohit Jain, Google)
const rohitLeadId = new ObjectId();
const rohitVisit = addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Rohit Jain'], start: at('Andheri', -7, '15:30'), lines: [[gs.Haircut, staff.Kabir]], status: 'COMPLETED', source: 'lead', leadId: rohitLeadId, pay: { method: 'UPI' } });

// ----- 2b. Today, around the current time: a calm, busy day with a couple of things to look at -----
const A = anchor('Andheri');
const minutesFrom = (t, m) => t.plus({ minutes: m });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Priya Sharma'], start: minutesFrom(A, -150), lines: [[gs['Hair Colour'], staff.Rahul]], status: 'COMPLETED', pay: { method: 'CARD', split: true } });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Amit Verma'], start: minutesFrom(A, -120), lines: [[gs.Facial, staff.Neha]], status: 'COMPLETED' }); // not paid yet
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Karan Malhotra'], start: minutesFrom(A, -60), lines: [[gs.Haircut, staff.Kabir], [gs['Beard Trim'], staff.Kabir]], comboDoc: combo['Haircut + Beard Trim'], status: 'IN_SERVICE' });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Sneha Kapoor'], start: minutesFrom(A, -25), lines: [[gs['Hair Spa'], staff.Rahul]], status: 'IN_SERVICE', source: 'walk-in' });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Ananya Iyer'], start: minutesFrom(A, 45), lines: [[gs.Haircut, staff.Rahul]] });
const poojaLeadId = new ObjectId();
const poojaBooking = addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Pooja Mehta'], start: minutesFrom(A, 90), lines: [[gs.Facial, staff.Neha]], source: 'lead', leadId: poojaLeadId });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Rohit Jain'], start: minutesFrom(A, 105), lines: [[gs['Beard Trim'], staff.Kabir]] });

const B = anchor('Bandra');
addAppointment({ salon: glamour, branchName: 'Bandra', customer: gc['Isha Patel'], start: minutesFrom(B, -60), lines: [[gs.Haircut, staff.Arjun]], status: 'COMPLETED', pay: { method: 'CASH' } });
addAppointment({ salon: glamour, branchName: 'Bandra', customer: gc['Meera Nair'], start: minutesFrom(B, 15), lines: [[gs.Manicure, staff.Zoya]] });

const D = anchor('Dubai Marina');
addAppointment({ salon: desertRose, branchName: 'Dubai Marina', customer: nextDesertCustomer(), start: minutesFrom(D, -90), lines: [[ds.Haircut, staff.Omar]], status: 'COMPLETED', pay: { method: 'UPI' } });
addAppointment({ salon: desertRose, branchName: 'Dubai Marina', customer: nextDesertCustomer(), start: minutesFrom(D, -10), lines: [[ds['Blow Dry'], staff.Layla]], status: 'IN_SERVICE' });
addAppointment({ salon: desertRose, branchName: 'Dubai Marina', customer: nextDesertCustomer(), start: minutesFrom(D, 30), lines: [[ds.Manicure, staff.Hana]] });

// ----- 2c. The next few days -----
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Amit Verma'], start: at('Andheri', 1, '11:00'), lines: [[gs.Haircut, staff.Rahul]] });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Kavita Joshi'], start: at('Andheri', 1, '12:00'), lines: [[gs.Facial, staff.Neha]] }); // Neha is on leave tomorrow -> needs reassigning
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Karan Malhotra'], start: at('Andheri', 1, '16:00'), lines: [[gs.Haircut, staff.Kabir], [gs['Beard Trim'], staff.Kabir]], comboDoc: combo['Haircut + Beard Trim'] });
addAppointment({ salon: glamour, branchName: 'Bandra', customer: gc['Isha Patel'], start: at('Bandra', 1, '14:00'), lines: [[gs.Manicure, staff.Zoya], [gs.Pedicure, staff.Zoya]], comboDoc: combo['Mani + Pedi'] });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Sneha Kapoor'], start: at('Andheri', 2, '10:30'), lines: [[gs['Hair Colour'], staff.Rahul]] });
addAppointment({ salon: glamour, branchName: 'Andheri', customer: gc['Priya Sharma'], start: at('Andheri', 2, '15:00'), lines: [[gs.Facial, staff.Neha]] });
addAppointment({ salon: desertRose, branchName: 'Dubai Marina', customer: desertCustomers[1], start: at('Dubai Marina', 3, '12:00'), lines: [[ds.Haircut, staff.Omar]] });

// ===========================================================================
// 3. Invoices for the paid appointments, numbered per branch in date order
// ===========================================================================
const CODE = { Andheri: 'AND', Bandra: 'BAN', 'Dubai Marina': 'DUB' };
const branchNameOf = (id) => Object.values(branch).find((b) => String(b._id) === String(id)).name;
const counters = {};
const invoices = [];

toBePaid.sort((x, y) => x.appointment.endAt - y.appointment.endAt);
for (const { appointment, method, discountPercent = 0, split = false } of toBePaid) {
  const name = branchNameOf(appointment.branchId);
  counters[name] = (counters[name] ?? 0) + 1;
  const discount = Math.round((appointment.totalPrice * discountPercent) / 100);
  const total = appointment.totalPrice - discount;
  // A split payment: about half by card, the rest by UPI (like "₹1,000 card + ₹530 UPI")
  const firstPart = Math.round(total / 2 / 100) * 100;
  const payments = split ? [{ method: 'CARD', amount: firstPart }, { method: 'UPI', amount: total - firstPart, reference: `UPI${counters[name]}${name.length}` }] : [{ method, amount: total }];

  const invoice = {
    _id: new ObjectId(),
    orgId: appointment.orgId,
    branchId: appointment.branchId,
    appointmentId: appointment._id,
    customerId: appointment.customerId,
    invoiceNumber: `GP-${CODE[name]}-${String(counters[name]).padStart(6, '0')}`,
    lines: appointment.items.map((i) => ({ serviceName: i.serviceName, staffName: i.staffName, price: i.price })),
    subtotal: appointment.totalPrice,
    discount,
    total,
    payments,
    paidAt: new Date(+appointment.endAt + 3 * 60 * 1000),
    createdBy: appointment.createdBy,
  };
  appointment.invoiceId = invoice._id;
  invoices.push(invoice);
}

await Appointment.insertMany(appointments);
// Written the way bills were saved before Billing Phase 1, then moved onto the new bill records by the same
// migration real salons get (so old bills keep numbers like GP-AND-000049 and new ones start at AND/26-27/00001)
await Invoice.collection.insertMany(invoices);
await Counter.insertMany(Object.entries(counters).map(([name, seq]) => ({ _id: `invoice:${branch[name]._id}`, seq })));
await migrateBilling({ log: () => {} });

// Billing settings: Glamour Studio is GST registered in Maharashtra (prices include GST); Desert Rose isn't
const demoGstin = (first14) => first14 + gstinCheckChar(first14);
await models.BillingSettings.create({
  orgId: glamour._id,
  legalName: 'Glamour Studio Private Limited',
  gstRegistered: true,
  pricesIncludeTax: true,
  defaultServiceTaxBps: 1800,
  defaultSacCode: '999721',
  branches: [
    { branchId: branch.Andheri._id, gstin: demoGstin('27AAKCG4821M1Z'), stateCode: '27', invoicePrefix: 'AND' },
    { branchId: branch.Bandra._id, gstin: demoGstin('27AAKCG4821M2Z'), stateCode: '27', invoicePrefix: 'BAN' },
  ],
});

// ===========================================================================
// 4. Leads (every status and source; one follow-up overdue)
// ===========================================================================
const now = DateTime.now();
const leadSalon = (branchName) => (branchName === 'Dubai Marina' ? desertRose : glamour);
const leadService = (branchName, name) => (branchName === 'Dubai Marina' ? ds : gs)[name];
await Lead.collection.insertMany(
  LEADS.map(([name, phone, branchName, source, status, hoursAgo, followUpInHours, service, note]) => {
    const createdAt = now.minus({ hours: hoursAgo }).toJSDate();
    const desk = deskOf[branchName];
    const converted = { 'Pooja Mehta': { _id: poojaLeadId, appointment: poojaBooking }, 'Rohit Jain': { _id: rohitLeadId, appointment: rohitVisit } }[name];
    const notes = [];
    if (note) notes.push({ _id: new ObjectId(), text: note, by: desk._id, at: now.minus({ hours: hoursAgo - 1 }).toJSDate() });
    if (converted) notes.push({ _id: new ObjectId(), text: 'Converted to an appointment', by: desk._id, at: now.minus({ hours: hoursAgo - 2 }).toJSDate() });
    return {
      _id: converted?._id ?? new ObjectId(),
      orgId: leadSalon(branchName)._id,
      branchId: branch[branchName]._id,
      name,
      phone,
      source,
      interestedServiceId: leadService(branchName, service)._id,
      assignedToUserId: desk._id,
      status,
      nextFollowUpAt: followUpInHours === null ? null : now.plus({ hours: followUpInHours }).toJSDate(),
      notes,
      customerId: converted?.appointment.customerId ?? null,
      appointmentId: converted?.appointment._id ?? null,
      createdAt,
      updatedAt: createdAt,
    };
  })
);

// ===========================================================================
// 5. Attendance: two weeks for Andheri, today everywhere, and Neha on leave tomorrow
// ===========================================================================
const attendance = [];
const mark = (branchName, stylist, days, status) => {
  const date = at(branchName, days, '00:00');
  const b = branch[branchName];
  const checkIn = status === 'present' && days <= 0 ? at(branchName, days, b.openTime).plus({ minutes: 5 + attendance.length % 10 }).toJSDate() : null;
  const checkOut = status === 'present' && days < 0 ? at(branchName, days, b.closeTime).minus({ minutes: 10 }).toJSDate() : null;
  attendance.push({ orgId: stylist.orgId, branchId: b._id, staffId: stylist._id, date: date.toISODate(), status, checkInAt: checkIn, checkOutAt: checkOut, markedBy: deskOf[branchName]._id });
};
for (let d = 1; d <= 14; d++) {
  mark('Andheri', staff.Rahul, -d, 'present');
  mark('Andheri', staff.Neha, -d, d === 11 ? 'leave' : 'present');
  mark('Andheri', staff.Kabir, -d, d === 3 ? 'absent' : d === 10 ? 'leave' : 'present');
}
for (const s of [staff.Rahul, staff.Neha, staff.Kabir, staff.Kavya]) mark('Andheri', s, 0, 'present');
mark('Bandra', staff.Arjun, 0, 'present'); // Zoya not marked yet today
for (const s of [staff.Omar, staff.Layla, staff.Hana]) mark('Dubai Marina', s, 0, 'present');
mark('Andheri', staff.Neha, 1, 'leave');
await Attendance.insertMany(attendance);

// ===========================================================================
// 6. Payroll: pay setups (made through the real payroll rules, so the activity log and bell fill up too).
//    Pay that starts in the past also works out commission on the bills above.
// ===========================================================================
// What tenantContext would build for a logged-in user
const asUser = (user) => ({
  orgId: String(user.orgId),
  userId: String(user._id),
  userName: user.name,
  role: user.role,
  isPrimaryOwner: user.role === 'OWNER' && user.allBranches,
  allowedBranchIds: (user.allBranches ? [branch.Andheri, branch.Bandra] : user.branchIds.map((id) => ({ _id: id }))).map((b) => String(b._id)),
});
const [anita, vikram, kavya] = users;
const monthStart = (monthsAgo) => A.minus({ months: monthsAgo }).startOf('month').toISODate();
const rupees = (amount) => toPaise(amount);

await payroll.createPlan(asUser(anita), staff.Rahul._id, { model: 'FIXED', monthlyBase: rupees(20000), effectiveFrom: monthStart(3) });
await payroll.setServiceRate(asUser(anita), staff.Rahul._id, gs['Hair Colour']._id, { rateBps: 1500 }); // colour pays more
await payroll.createPlan(asUser(anita), staff.Rahul._id, { model: 'FIXED_COMMISSION', monthlyBase: rupees(22000), commissionBps: 1000, effectiveFrom: monthStart(1), note: 'Promoted to senior stylist' });
await payroll.createPlan(asUser(anita), staff.Neha._id, { model: 'FIXED', monthlyBase: rupees(18000), effectiveFrom: monthStart(3) });
await payroll.createPlan(asUser(anita), staff.Kabir._id, { model: 'COMMISSION', commissionBps: 3500, effectiveFrom: monthStart(2) });
await payroll.createPlan(asUser(vikram), staff.Arjun._id, { model: 'HYBRID', dailyRate: rupees(700), commissionBps: 800, effectiveFrom: monthStart(2) });
await payroll.createPlan(asUser(vikram), staff.Zoya._id, { model: 'ASSIGNMENT', assignmentRate: rupees(250), effectiveFrom: monthStart(1) });
// Front desk members: salary or day rate, never commission
await payroll.createPlan(asUser(anita), staff.Kavya._id, { model: 'FIXED', monthlyBase: rupees(15000), effectiveFrom: monthStart(3) });
await payroll.createPlan(asUser(vikram), staff.Ritu._id, { model: 'DAILY', dailyRate: rupees(600), effectiveFrom: monthStart(2) });
// A front desk request waiting for approval
await payroll.createRequest(asUser(kavya), {
  staffId: String(staff.Neha._id),
  model: 'FIXED',
  monthlyBase: rupees(20000),
  effectiveFrom: A.plus({ months: 1 }).startOf('month').toISODate(),
  note: 'Neha completed one year; raise agreed at the review',
});
// (Desert Rose staff have no pay setup yet, to show the "not set up" state)
// Monthly payroll: two months ago is locked at Andheri; last month has a bonus and is still a draft
const anitaAtAndheri = { ...asUser(anita), activeBranchId: String(branch.Andheri._id) };
await monthlyPayroll.lockRun(anitaAtAndheri, A.minus({ months: 2 }).toFormat('yyyy-MM'));
// That locked month: Rahul paid in full by bank transfer, Neha paid part in cash, so something is still owed
const lockedMonth = A.minus({ months: 2 }).toFormat('yyyy-MM');
const lockedItem = (stylist) => models.PayrollItem.findOne({ month: lockedMonth, staffId: stylist._id }).lean();
const paidOn = A.minus({ months: 1 }).startOf('month').plus({ days: 2 }).toISODate();
await salaryPayments.recordPayment(anitaAtAndheri, (await lockedItem(staff.Rahul))._id, { amount: rupees(20000), method: 'BANK', reference: 'NEFT 88231', paidOn }, 'seed-pay-rahul');
await salaryPayments.recordPayment(anitaAtAndheri, (await lockedItem(staff.Neha))._id, { amount: rupees(10000), method: 'CASH', paidOn }, 'seed-pay-neha');
// An advance for Neha, taken back from next month
await salaryPayments.giveAdvance(
  anitaAtAndheri,
  staff.Neha._id,
  { amount: rupees(6000), monthlyRepayment: rupees(2000), method: 'UPI', givenOn: A.toISODate(), firstMonth: A.plus({ months: 1 }).toFormat('yyyy-MM'), reason: 'Rent deposit' },
  'seed-advance-neha'
);
await monthlyPayroll.addAdjustment(anitaAtAndheri, {
  staffId: String(staff.Neha._id),
  month: A.minus({ months: 1 }).toFormat('yyyy-MM'),
  kind: 'bonus',
  amount: rupees(1500),
  reason: 'Best customer reviews',
});

// ===========================================================================
// 7. Inventory add-on: Glamour Studio has it (Andheri is set up, Bandra isn't yet); Desert Rose doesn't.
//    Made through the real inventory code, so every stock change is a movement in the history.
// ===========================================================================
await Organization.updateOne({ _id: glamour._id }, { $set: { 'addons.inventory.enabled': true, 'addons.inventory.enabledAt': new Date() } });
const suresh = await User.create({ orgId: glamour._id, role: 'INVENTORY', name: 'Suresh (Andheri stock)', email: 'inventory.andheri@glamour.com', passwordHash, branchIds: [branch.Andheri._id] });
const atAndheri = (user) => ({ ...asUser(user), activeBranchId: String(branch.Andheri._id), allowedBranchIds: user.allBranches ? asUser(user).allowedBranchIds : [String(branch.Andheri._id)], addons: ['inventory'] });
const owner = atAndheri(anita);
const keeper = atAndheri(suresh);
const desk = atAndheri(kavya);
let seedKey = 0;
const key = () => `seed-inventory-${++seedKey}`;

const colourBar = (await createLocation(owner, { kind: 'STATION', name: 'Colour bar' }, key())).location;
await createLocation(owner, { kind: 'STATION', name: 'Chair 1' }, key());
const lakme = (await createSupplier(owner, { name: 'Lakme Pro Distributors', contactName: 'Sanjay', phone: '9819900011', paymentTerms: '30 days', leadTimeDays: 3 }, key())).supplier;
const beautyMart = (await createSupplier(keeper, { name: 'Beauty Mart Wholesale', phone: '9819900022', paymentTerms: 'Cash on delivery', leadTimeDays: 1 }, key())).supplier;

const product = async (input) => (await createSku(owner, input, key())).sku;
const sku = {
  shampoo: await product({ name: 'Loreal Shampoo 1L', category: 'Hair care', brand: 'Loreal', stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty: 8, openingUnitCost: rupees(650), reorderPoint: 3, reorderQty: 6, preferredSupplierId: String(lakme._id), barcodes: ['8901030703461'] }),
  conditioner: await product({ name: 'Loreal Conditioner 1L', category: 'Hair care', brand: 'Loreal', stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty: 5, openingUnitCost: rupees(700), reorderPoint: 2, reorderQty: 4, preferredSupplierId: String(lakme._id) }),
  wax: await product({ name: 'Rica Wax 800 ml', category: 'Waxing', stockUnit: 'jar', wayOfUse: 'FINISH', openingQty: 2, openingUnitCost: rupees(900), reorderPoint: 2, reorderQty: 4, preferredSupplierId: String(beautyMart._id) }),
  facialKit: await product({ name: 'Gold facial kit', category: 'Skin', stockUnit: 'kit', wayOfUse: 'SERVICE_UNITS', openingQty: 12, openingUnitCost: rupees(480), reorderPoint: 4, reorderQty: 10, preferredSupplierId: String(beautyMart._id) }),
  developer: await product({ name: 'Developer 6% (1 L)', category: 'Colour', stockUnit: 'bottle', wayOfUse: 'SERVICE_MEASURED', baseUnit: 'ml', unitsPerStockUnit: 1000, openingQty: 3400, openingUnitCost: rupees(550), reorderPoint: 1000, reorderQty: 3000, preferredSupplierId: String(lakme._id) }),
  colour: await product({ name: 'Majirel colour tube 50 g', category: 'Colour', stockUnit: 'tube', wayOfUse: 'SERVICE_MEASURED', baseUnit: 'g', unitsPerStockUnit: 50, openingQty: 600, openingUnitCost: rupees(420), reorderPoint: 150, reorderQty: 500, preferredSupplierId: String(lakme._id) }),
  gloves: await product({ name: 'Disposable gloves', category: 'Supplies', stockUnit: 'box', wayOfUse: 'MANUAL', openingQty: 6, openingUnitCost: rupees(250) }),
};

// What services use: a facial takes one kit; hair colour takes colour and developer; shampoo is linked to haircuts (for reports)
await saveRecipe(owner, { serviceId: String(gs.Facial._id), scope: 'salon', lines: [{ skuId: String(sku.facialKit._id), qty: 1, deducts: true }] }, key());
await saveRecipe(owner, { serviceId: String(gs['Hair Colour']._id), scope: 'salon', lines: [{ skuId: String(sku.colour._id), qty: 60, deducts: true }, { skuId: String(sku.developer._id), qty: 60, deducts: true }] }, key());
await saveRecipe(owner, { serviceId: String(gs.Haircut._id), scope: 'salon', lines: [{ skuId: String(sku.shampoo._id), deducts: false }] }, key());

// Hand-outs: shampoo with Rahul (one already finished and replaced), developer and colour at the colour bar, wax with Neha
const mainStore = (await models.InventoryLocation.findOne({ branchId: branch.Andheri._id, isMain: true }).lean())._id;
const rahulRecipient = { kind: 'STAFF', id: String(staff.Rahul._id) };
const firstShampoo = (await issue(keeper, { skuId: String(sku.shampoo._id), locationId: String(mainStore), recipient: rahulRecipient, qty: 1 }, key())).allocation;
await finish(keeper, String(firstShampoo._id), { qty: 1, replacement: { qty: 1 } }, key());
await issue(keeper, { skuId: String(sku.developer._id), locationId: String(mainStore), recipient: { kind: 'STATION', id: String(colourBar._id) }, qty: 1000 }, key());
await issue(keeper, { skuId: String(sku.colour._id), locationId: String(mainStore), recipient: { kind: 'STATION', id: String(colourBar._id) }, qty: 100 }, key());
await issue(owner, { skuId: String(sku.wax._id), locationId: String(mainStore), recipient: { kind: 'STAFF', id: String(staff.Neha._id) }, qty: 1 }, key());

// A part-delivered order from Lakme, a draft for Beauty Mart, a damaged conditioner and two things waiting
const lakmeOrder = (await createOrder(owner, { supplierId: String(lakme._id), lines: [{ skuId: String(sku.shampoo._id), qty: 6, unitCost: rupees(650) }, { skuId: String(sku.developer._id), qty: 3000, unitCost: rupees(560) }], note: 'Monthly order' }, key())).order;
await submitOrder(owner, String(lakmeOrder._id), key());
await moveOrder(owner, String(lakmeOrder._id), 'order', {}, key());
const orderedLines = (await models.InventoryPurchaseOrder.findById(lakmeOrder._id).lean()).lines;
await receiveOrder(keeper, String(lakmeOrder._id), { invoiceNumber: 'LPD-20431', lines: [{ lineId: String(orderedLines[0]._id), qty: 6 }] }, key());
await createOrder(keeper, { supplierId: String(beautyMart._id), lines: [{ skuId: String(sku.wax._id), qty: 4 }] }, key());
await writeOff(owner, { skuId: String(sku.conditioner._id), locationId: String(mainStore), qty: 1, reason: 'DAMAGE', direction: 'REMOVE', note: 'Cap cracked in delivery' }, key());
await writeOff(keeper, { skuId: String(sku.facialKit._id), locationId: String(mainStore), qty: 5, reason: 'EXPIRY', direction: 'REMOVE', note: 'Batch expired last week' }, key()); // ₹2,400: waits for an owner
await reportProblem(desk, { skuId: String(sku.gloves._id), locationId: String(mainStore), reason: 'DAMAGE', qty: 1, note: 'Box got wet near the sink' }, key());
// Simple generated photos for a few products, so the catalogue has pictures (real photos are uploaded in the app)
const photoOf = (label, colour) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${colour}"/><text x="400" y="420" font-family="Arial, sans-serif" font-size="64" fill="#ffffff" text-anchor="middle">${label}</text></svg>`))
    .png()
    .toBuffer();
for (const [product, label, colour] of [[sku.shampoo, 'Shampoo', '#6b4226'], [sku.facialKit, 'Facial kit', '#c9a227'], [sku.developer, 'Developer', '#8a5a3b'], [sku.wax, 'Wax', '#b08d1f']]) {
  await addImages(owner, String(product._id), [{ buffer: await photoOf(label, colour), originalname: `${product.code}.png` }], key());
}
await markSetupStep(owner, 'locations', key());
await markSetupStep(owner, 'done', key());

// ===========================================================================
// Done
// ===========================================================================
console.log(`\nSeeded: 2 salons, 3 branches, ${Object.keys(staff).length} staff, ${GLAMOUR_SERVICES.length + DESERT_ROSE_SERVICES.length} services, 2 combos,`);
console.log(`        ${glamourCustomers.length + desertCustomers.length} customers, ${LEADS.length} leads, ${appointments.length} appointments, ${invoices.length} invoices, ${attendance.length} attendance records`);
console.log(`        8 pay setups (2 front desk), 1 pay change request waiting for approval, 1 locked payroll month with payments, 1 advance, ${await models.CommissionEntry.countDocuments()} commission lines`);
console.log(`        Inventory (Glamour Andheri): ${Object.keys(sku).length} products, 3 recipes, 4 hand-outs, 2 purchase orders, 1 write-off waiting for approval, 1 problem report, 4 product photos`);
console.log(`Today is centred on ${A.toFormat('h:mm a')} at Andheri (${A.zoneName}).`);
console.log('\nEvery account uses the password:', DEMO_PASSWORD);
console.table([
  { role: 'Super Admin', email: 'admin@growwpilot.com', access: 'All salons' },
  { role: 'Owner (primary)', email: 'owner@glamour.com', access: 'Glamour Studio: Andheri + Bandra' },
  { role: 'Owner (branch)', email: 'bandra.owner@glamour.com', access: 'Glamour Studio: Bandra only' },
  { role: 'Front Desk', email: 'desk.andheri@glamour.com', access: 'Glamour Studio: Andheri' },
  { role: 'Front Desk', email: 'desk.bandra@glamour.com', access: 'Glamour Studio: Bandra' },
  { role: 'Inventory', email: 'inventory.andheri@glamour.com', access: 'Glamour Studio: Andheri, Inventory only' },
  { role: 'Owner', email: 'owner@desertrose.com', access: 'Desert Rose: Dubai Marina' },
  { role: 'Front Desk', email: 'desk@desertrose.com', access: 'Desert Rose: Dubai Marina' },
]);

await mongoose.disconnect();
