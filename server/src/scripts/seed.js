// Wipes the database and fills it with a small demo: 2 salons, 3 branches, some history, a busy "today",
// payroll, billing, birthday offers, a few emails, and the Inventory add-on at Glamour Studio's Andheri branch
// (Bandra is left to show the setup guide). Today's appointments are placed around the CURRENT time, so the day
// board and dashboard always look alive.
//
// Run with: npm run seed        (refuses to run in production unless you add -- --force)
import mongoose from 'mongoose';
import sharp from 'sharp';
import { DateTime } from 'luxon';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import { gstinCheckChar } from '../config/billing.js';
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
import { addProduct, createSaleDraft, issueInvoice, openDraft } from '../modules/invoices/invoices.service.js';
import { takeAdvance } from '../modules/payments/payments.service.js';
import { approveRefund, createRefund } from '../modules/refunds/refunds.service.js';
import { closeCashDay, currentCashDay } from '../modules/cash/cash.service.js';
import { createCampaign, publishCampaign } from '../modules/occasions/campaigns/campaigns.service.js';
import { recordConsent } from '../modules/occasions/customers.service.js';
import { recordContact } from '../modules/occasions/outreach/followup.service.js';
import { setInvoiceOffer } from '../modules/occasions/checkout/checkout.service.js';
import { runForOrg } from '../modules/occasions/engine/scheduler.js';
import { migrateBilling } from './migrate-billing-v2.js';
import { migrateOccasions } from './migrate-occasions-v1.js';
import { saveSetup } from '../modules/gst/gst.service.js';
import { addPurchase, import2b } from '../modules/gst/gst.purchases.js';
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
// 1. Salons, branches, logins, staff, services, combo, customers
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

const [anita, vikram, kavya, ritu, fatima, maya] = await User.create([
  { orgId: glamour._id, role: 'OWNER', name: 'Anita Mehra', email: 'owner@glamour.com', passwordHash, allBranches: true },
  { orgId: glamour._id, role: 'OWNER', name: 'Vikram Shah', email: 'bandra.owner@glamour.com', passwordHash, branchIds: [branch.Bandra._id] }, // branch owner
  { orgId: glamour._id, role: 'FRONT_DESK', name: 'Kavya (Andheri desk)', email: 'desk.andheri@glamour.com', passwordHash, branchIds: [branch.Andheri._id] },
  { orgId: glamour._id, role: 'FRONT_DESK', name: 'Ritu (Bandra desk)', email: 'desk.bandra@glamour.com', passwordHash, branchIds: [branch.Bandra._id] },
  { orgId: desertRose._id, role: 'OWNER', name: 'Fatima Khan', email: 'owner@desertrose.com', passwordHash, allBranches: true },
  { orgId: desertRose._id, role: 'FRONT_DESK', name: 'Maya (Marina desk)', email: 'desk@desertrose.com', passwordHash, branchIds: [branch['Dubai Marina']._id] },
]);
// The front desk user of each branch (they "created" that branch's bookings)
const deskOf = { Andheri: kavya, Bandra: ritu, 'Dubai Marina': maya };

const staff = byName(
  await Staff.create([
    { orgId: glamour._id, branchId: branch.Andheri._id, name: 'Rahul', role: 'Senior Stylist', phone: '9811111111' },
    { orgId: glamour._id, branchId: branch.Andheri._id, name: 'Neha', role: 'Beautician', phone: '9822222222' },
    { orgId: glamour._id, branchId: branch.Bandra._id, name: 'Arjun', role: 'Stylist', phone: '9844444444' },
    { orgId: desertRose._id, branchId: branch['Dubai Marina']._id, name: 'Omar', role: 'Barber' },
    // Front desk members: paid like everyone else, never booked, linked to their login
    { orgId: glamour._id, branchId: branch.Andheri._id, name: 'Kavya', kind: 'FRONT_DESK', role: 'Receptionist', userId: kavya._id },
    { orgId: glamour._id, branchId: branch.Bandra._id, name: 'Ritu', kind: 'FRONT_DESK', role: 'Receptionist', userId: ritu._id },
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

const combo = await Combo.create({ orgId: glamour._id, name: 'Haircut + Beard Trim', serviceIds: [gs.Haircut._id, gs['Beard Trim']._id], comboPrice: toPaise(600) });
const comboLines = [[gs.Haircut, staff.Rahul], [gs['Beard Trim'], staff.Rahul]];

const glamourCustomers = await Customer.create(GLAMOUR_CUSTOMERS.map(([name, phone]) => ({ orgId: glamour._id, name, phone })));
const desertCustomers = await Customer.create(DESERT_ROSE_CUSTOMERS.map(([name, phone]) => ({ orgId: desertRose._id, name, phone })));
const gc = byName(glamourCustomers);

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
function appointmentDoc({ salon, branchName, customer, start, lines, status = 'BOOKED', comboDoc, source = 'phone', leadId }) {
  const b = branch[branchName];
  const desk = deskOf[branchName];
  let cursor = start;
  const items = lines.map(([service, stylist]) => {
    const minutes = service.durationMinutes ?? b.defaultServiceMinutes;
    const item = { _id: new ObjectId(), serviceId: service._id, serviceName: service.name, staffId: stylist._id, staffName: stylist.name, startAt: cursor.toJSDate(), endAt: cursor.plus({ minutes }).toJSDate(), durationMinutes: minutes, price: service.price };
    cursor = cursor.plus({ minutes });
    return item;
  });
  return {
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
}
function addAppointment({ pay, ...details }) {
  const appointment = appointmentDoc(details);
  appointments.push(appointment);
  if (pay) toBePaid.push({ appointment, ...pay });
  return appointment;
}
const andheri = (details) => addAppointment({ salon: glamour, branchName: 'Andheri', ...details });
const bandra = (details) => addAppointment({ salon: glamour, branchName: 'Bandra', ...details });
const marina = (details) => addAppointment({ salon: desertRose, branchName: 'Dubai Marina', ...details });

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

// ----- 2a. History: the last week, plus the same weekday 2, 3 and 4 weeks ago for "revenue vs usual" -----
const PAY_METHODS = ['CASH', 'UPI', 'CARD'];
const customerInTurn = (d) => glamourCustomers[d % glamourCustomers.length];
for (const d of [1, 2, 3, 4, 5, 6, 7, 14, 21, 28]) {
  andheri({ customer: customerInTurn(d), start: at('Andheri', -d, '11:00'), lines: [[d % 2 ? gs.Haircut : gs['Hair Colour'], staff.Rahul]], status: 'COMPLETED', pay: { method: PAY_METHODS[d % 3], discountPercent: d % 7 === 0 ? 10 : 0, split: d % 5 === 0 } });
  if (d % 2 === 0) andheri({ customer: customerInTurn(d + 1), start: at('Andheri', -d, '15:00'), lines: [[gs.Facial, staff.Neha]], status: 'COMPLETED', pay: { method: 'UPI' } });
  if (d % 4 === 1) andheri({ customer: customerInTurn(d + 2), start: at('Andheri', -d, '13:00'), lines: comboLines, comboDoc: combo, status: 'COMPLETED', pay: { method: 'CASH' } });
  if (d % 6 === 0) andheri({ customer: customerInTurn(d + 3), start: at('Andheri', -d, '17:00'), lines: [[gs['Beard Trim'], staff.Rahul]], status: 'CANCELLED' });
  if (d % 3 === 0) bandra({ customer: customerInTurn(d + 4), start: at('Bandra', -d, '13:00'), lines: [[gs.Haircut, staff.Arjun], [gs['Hair Spa'], staff.Arjun]], status: 'COMPLETED', pay: { method: 'CARD', split: d % 2 === 0 } });
  if (d % 3 === 1) marina({ customer: desertCustomers[d % 2], start: at('Dubai Marina', -d, '18:00'), lines: [[ds.Haircut, staff.Omar]], status: 'COMPLETED', pay: { method: 'CARD' } });
}

// ----- 2b. Today, around the current time -----
const A = anchor('Andheri');
const B = anchor('Bandra');
const D = anchor('Dubai Marina');
const minutesFrom = (t, m) => t.plus({ minutes: m });
andheri({ customer: gc['Priya Sharma'], start: minutesFrom(A, -150), lines: [[gs['Hair Colour'], staff.Rahul]], status: 'COMPLETED', pay: { method: 'CARD', split: true } });
andheri({ customer: gc['Amit Verma'], start: minutesFrom(A, -120), lines: [[gs.Facial, staff.Neha]], status: 'COMPLETED' }); // not paid: shows in Requires attention
andheri({ customer: gc['Karan Malhotra'], start: minutesFrom(A, -50), lines: comboLines, comboDoc: combo, status: 'IN_SERVICE' });
andheri({ customer: gc['Sneha Kapoor'], start: minutesFrom(A, 45), lines: [[gs.Haircut, staff.Rahul]] });
const poojaLeadId = new ObjectId();
const poojaBooking = andheri({ customer: gc['Pooja Mehta'], start: minutesFrom(A, 90), lines: [[gs.Facial, staff.Neha]], source: 'lead', leadId: poojaLeadId });
bandra({ customer: gc['Isha Patel'], start: minutesFrom(B, -60), lines: [[gs.Haircut, staff.Arjun]], status: 'COMPLETED', pay: { method: 'CASH' } });
bandra({ customer: gc['Meera Nair'], start: minutesFrom(B, 15), lines: [[gs.Haircut, staff.Arjun]] });
marina({ customer: desertCustomers[0], start: minutesFrom(D, -90), lines: [[ds.Haircut, staff.Omar]], status: 'COMPLETED', pay: { method: 'UPI' } });
marina({ customer: desertCustomers[1], start: minutesFrom(D, 30), lines: [[ds['Blow Dry'], staff.Omar]] });

// ----- 2c. Tomorrow (Neha is on leave, so her booking needs reassigning) -----
andheri({ customer: gc['Amit Verma'], start: at('Andheri', 1, '11:00'), lines: [[gs.Haircut, staff.Rahul]] });
andheri({ customer: gc['Priya Sharma'], start: at('Andheri', 1, '12:00'), lines: [[gs.Facial, staff.Neha]] });
bandra({ customer: gc['Isha Patel'], start: at('Bandra', 1, '14:00'), lines: [[gs['Hair Spa'], staff.Arjun]] });

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
// Past bills are saved in the old shape, then moved onto the current bill records by the same migration real salons
// get. This is what lets them keep past dates (and numbers like GP-AND-000012; new bills start at AND/26-27/00001).
await Invoice.collection.insertMany(invoices);
await Counter.insertMany(Object.entries(counters).map(([name, seq]) => ({ _id: `invoice:${branch[name]._id}`, seq })));
await migrateBilling({ log: () => {} });
await migrateOccasions({ log: () => {} }); // home branches and "not recorded" permission for the demo customers

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
// 4. Leads
// ===========================================================================
const now = DateTime.now();
await Lead.collection.insertMany(
  LEADS.map(([name, phone, branchName, source, status, hoursAgo, followUpInHours, service, note]) => {
    const createdAt = now.minus({ hours: hoursAgo }).toJSDate();
    const desk = deskOf[branchName];
    const converted = name === 'Pooja Mehta';
    const notes = [];
    if (note) notes.push({ _id: new ObjectId(), text: note, by: desk._id, at: now.minus({ hours: hoursAgo - 1 }).toJSDate() });
    if (converted) notes.push({ _id: new ObjectId(), text: 'Converted to an appointment', by: desk._id, at: now.minus({ hours: hoursAgo - 2 }).toJSDate() });
    return {
      _id: converted ? poojaLeadId : new ObjectId(),
      orgId: (branchName === 'Dubai Marina' ? desertRose : glamour)._id,
      branchId: branch[branchName]._id,
      name,
      phone,
      source,
      interestedServiceId: (branchName === 'Dubai Marina' ? ds : gs)[service]._id,
      assignedToUserId: desk._id,
      status,
      nextFollowUpAt: followUpInHours === null ? null : now.plus({ hours: followUpInHours }).toJSDate(),
      notes,
      customerId: converted ? poojaBooking.customerId : null,
      appointmentId: converted ? poojaBooking._id : null,
      createdAt,
      updatedAt: createdAt,
    };
  })
);

// ===========================================================================
// 5. Attendance: one week at Andheri, today everywhere, and Neha on leave tomorrow
// ===========================================================================
const attendance = [];
const mark = (branchName, person, days, status) => {
  const b = branch[branchName];
  const checkIn = status === 'present' && days <= 0 ? at(branchName, days, b.openTime).plus({ minutes: 5 + attendance.length % 10 }).toJSDate() : null;
  const checkOut = status === 'present' && days < 0 ? at(branchName, days, b.closeTime).minus({ minutes: 10 }).toJSDate() : null;
  attendance.push({ orgId: person.orgId, branchId: b._id, staffId: person._id, date: at(branchName, days, '00:00').toISODate(), status, checkInAt: checkIn, checkOutAt: checkOut, markedBy: deskOf[branchName]._id });
};
for (let d = 1; d <= 7; d++) {
  mark('Andheri', staff.Rahul, -d, d === 3 ? 'absent' : 'present');
  mark('Andheri', staff.Neha, -d, d === 5 ? 'leave' : 'present');
}
for (const person of [staff.Rahul, staff.Neha, staff.Kavya]) mark('Andheri', person, 0, 'present');
mark('Bandra', staff.Arjun, 0, 'present');
mark('Dubai Marina', staff.Omar, 0, 'present');
mark('Andheri', staff.Neha, 1, 'leave');
await Attendance.insertMany(attendance);

// ===========================================================================
// 6. Payroll, made through the real payroll rules. Desert Rose has no pay setup, to show that state.
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
const monthStart = (monthsAgo) => A.minus({ months: monthsAgo }).startOf('month').toISODate();

await payroll.createPlan(asUser(anita), staff.Rahul._id, { model: 'FIXED', monthlyBase: toPaise(20000), effectiveFrom: monthStart(3) });
await payroll.setServiceRate(asUser(anita), staff.Rahul._id, gs['Hair Colour']._id, { rateBps: 1500 }); // colour pays more
await payroll.createPlan(asUser(anita), staff.Rahul._id, { model: 'FIXED_COMMISSION', monthlyBase: toPaise(22000), commissionBps: 1000, effectiveFrom: monthStart(1), note: 'Promoted to senior stylist' });
await payroll.createPlan(asUser(anita), staff.Neha._id, { model: 'FIXED', monthlyBase: toPaise(18000), effectiveFrom: monthStart(3) });
await payroll.createPlan(asUser(vikram), staff.Arjun._id, { model: 'HYBRID', dailyRate: toPaise(700), commissionBps: 800, effectiveFrom: monthStart(2) });
await payroll.createPlan(asUser(anita), staff.Kavya._id, { model: 'FIXED', monthlyBase: toPaise(15000), effectiveFrom: monthStart(3) });
await payroll.createPlan(asUser(vikram), staff.Ritu._id, { model: 'DAILY', dailyRate: toPaise(600), effectiveFrom: monthStart(2) });
// A front desk request waiting for approval
await payroll.createRequest(asUser(kavya), { staffId: String(staff.Neha._id), model: 'FIXED', monthlyBase: toPaise(20000), effectiveFrom: A.plus({ months: 1 }).startOf('month').toISODate(), note: 'Neha completed one year; raise agreed at the review' });

// Two months ago is locked at Andheri: Rahul paid in full, Neha in part. Last month is a draft with a bonus. Neha has an advance.
const anitaAtAndheri = { ...asUser(anita), activeBranchId: String(branch.Andheri._id) };
const lockedMonth = A.minus({ months: 2 }).toFormat('yyyy-MM');
await monthlyPayroll.lockRun(anitaAtAndheri, lockedMonth);
const lockedItem = (person) => models.PayrollItem.findOne({ month: lockedMonth, staffId: person._id }).lean();
const paidOn = A.minus({ months: 1 }).startOf('month').plus({ days: 2 }).toISODate();
await salaryPayments.recordPayment(anitaAtAndheri, (await lockedItem(staff.Rahul))._id, { amount: toPaise(20000), method: 'BANK', reference: 'NEFT 88231', paidOn }, 'seed-pay-rahul');
await salaryPayments.recordPayment(anitaAtAndheri, (await lockedItem(staff.Neha))._id, { amount: toPaise(10000), method: 'CASH', paidOn }, 'seed-pay-neha');
await salaryPayments.giveAdvance(anitaAtAndheri, staff.Neha._id, { amount: toPaise(6000), monthlyRepayment: toPaise(2000), method: 'UPI', givenOn: A.toISODate(), firstMonth: A.plus({ months: 1 }).toFormat('yyyy-MM'), reason: 'Rent deposit' }, 'seed-advance-neha');
await monthlyPayroll.addAdjustment(anitaAtAndheri, { staffId: String(staff.Neha._id), month: A.minus({ months: 1 }).toFormat('yyyy-MM'), kind: 'bonus', amount: toPaise(1500), reason: 'Best customer reviews' });

// ===========================================================================
// 7. Inventory add-on: Glamour Studio has it (Andheri is set up, Bandra isn't); Desert Rose doesn't.
//    Made through the real inventory code, so every stock change is a movement in the history.
// ===========================================================================
await Organization.updateOne({ _id: glamour._id }, { $set: { 'addons.inventory.enabled': true, 'addons.inventory.enabledAt': new Date() } });
const suresh = await User.create({ orgId: glamour._id, role: 'INVENTORY', name: 'Suresh (Andheri stock)', email: 'inventory.andheri@glamour.com', passwordHash, branchIds: [branch.Andheri._id] });
const atAndheri = (user) => ({ ...asUser(user), activeBranchId: String(branch.Andheri._id), allowedBranchIds: user.allBranches ? asUser(user).allowedBranchIds : [String(branch.Andheri._id)], addons: ['inventory'] });
const owner = atAndheri(anita);
const keeper = atAndheri(suresh);
const desk = atAndheri(kavya);
let seedKey = 0;
const key = () => `seed-${++seedKey}`; // a fresh Idempotency-Key for each change

const colourBar = (await createLocation(owner, { kind: 'STATION', name: 'Colour bar' }, key())).location;
const lakme = (await createSupplier(owner, { name: 'Lakme Pro Distributors', contactName: 'Sanjay', phone: '9819900011', paymentTerms: '30 days', leadTimeDays: 3 }, key())).supplier;

// One product for each way stock is used, and one for sale on bills
const product = async (input) => (await createSku(owner, input, key())).sku;
const sku = {
  shampoo: await product({ name: 'Loreal Shampoo 1L', category: 'Hair care', brand: 'Loreal', stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty: 8, openingUnitCost: toPaise(650), reorderPoint: 3, reorderQty: 6, preferredSupplierId: String(lakme._id), barcodes: ['8901030703461'] }),
  facialKit: await product({ name: 'Gold facial kit', category: 'Skin', stockUnit: 'kit', wayOfUse: 'SERVICE_UNITS', openingQty: 12, openingUnitCost: toPaise(480), reorderPoint: 4, reorderQty: 10, preferredSupplierId: String(lakme._id) }),
  developer: await product({ name: 'Developer 6% (1 L)', category: 'Colour', stockUnit: 'bottle', wayOfUse: 'SERVICE_MEASURED', baseUnit: 'ml', unitsPerStockUnit: 1000, openingQty: 3400, openingUnitCost: toPaise(550), reorderPoint: 1000, reorderQty: 3000, preferredSupplierId: String(lakme._id) }),
  gloves: await product({ name: 'Disposable gloves', category: 'Supplies', stockUnit: 'box', wayOfUse: 'MANUAL', openingQty: 6, openingUnitCost: toPaise(250) }),
  serum: await product({ name: 'Argan hair serum 100 ml', category: 'Retail', brand: 'Moroccanoil', type: 'RETAIL', stockUnit: 'bottle', wayOfUse: 'MANUAL', sellPrice: toPaise(1180), hsnCode: '3305', openingQty: 12, openingUnitCost: toPaise(620), reorderPoint: 3, reorderQty: 12, barcodes: ['8904099412001'] }),
};

// What services use: a facial takes one kit; hair colour takes developer
await saveRecipe(owner, { serviceId: String(gs.Facial._id), scope: 'salon', lines: [{ skuId: String(sku.facialKit._id), qty: 1, deducts: true }] }, key());
await saveRecipe(owner, { serviceId: String(gs['Hair Colour']._id), scope: 'salon', lines: [{ skuId: String(sku.developer._id), qty: 60, deducts: true }] }, key());

// Hand-outs: shampoo with Rahul (one already finished and replaced), developer at the colour bar
const mainStore = (await models.InventoryLocation.findOne({ branchId: branch.Andheri._id, isMain: true }).lean())._id;
const firstShampoo = (await issue(keeper, { skuId: String(sku.shampoo._id), locationId: String(mainStore), recipient: { kind: 'STAFF', id: String(staff.Rahul._id) }, qty: 1 }, key())).allocation;
await finish(keeper, String(firstShampoo._id), { qty: 1, replacement: { qty: 1 } }, key());
await issue(keeper, { skuId: String(sku.developer._id), locationId: String(mainStore), recipient: { kind: 'STATION', id: String(colourBar._id) }, qty: 1000 }, key());

// A part-delivered order, a draft, a write-off waiting for approval (₹2,400) and a front desk problem report
const lakmeOrder = (await createOrder(owner, { supplierId: String(lakme._id), lines: [{ skuId: String(sku.shampoo._id), qty: 6, unitCost: toPaise(650) }, { skuId: String(sku.developer._id), qty: 3000, unitCost: toPaise(560) }], note: 'Monthly order' }, key())).order;
await submitOrder(owner, String(lakmeOrder._id), key());
await moveOrder(owner, String(lakmeOrder._id), 'order', {}, key());
const orderedLines = (await models.InventoryPurchaseOrder.findById(lakmeOrder._id).lean()).lines;
await receiveOrder(keeper, String(lakmeOrder._id), { invoiceNumber: 'LPD-20431', lines: [{ lineId: String(orderedLines[0]._id), qty: 6 }] }, key());
await createOrder(keeper, { supplierId: String(lakme._id), lines: [{ skuId: String(sku.gloves._id), qty: 4 }] }, key());
await writeOff(keeper, { skuId: String(sku.facialKit._id), locationId: String(mainStore), qty: 5, reason: 'EXPIRY', direction: 'REMOVE', note: 'Batch expired last week' }, key());
await reportProblem(desk, { skuId: String(sku.gloves._id), locationId: String(mainStore), reason: 'DAMAGE', qty: 1, note: 'Box got wet near the sink' }, key());

// Simple generated photos, so the catalogue has pictures
const photoOf = (label, colour) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${colour}"/><text x="400" y="420" font-family="Arial, sans-serif" font-size="64" fill="#ffffff" text-anchor="middle">${label}</text></svg>`))
    .png()
    .toBuffer();
for (const [item, label, colour] of [[sku.shampoo, 'Shampoo', '#6b4226'], [sku.facialKit, 'Facial kit', '#c9a227']]) {
  await addImages(owner, String(item._id), [{ buffer: await photoOf(label, colour), originalname: `${item.code}.png` }], key());
}
await markSetupStep(owner, 'locations', key());
await markSetupStep(owner, 'done', key());

// ===========================================================================
// 8. Billing, made through the real billing code, like a day at the desk.
//    Glamour Studio is GST registered; Desert Rose is not (plain bills).
// ===========================================================================
const atMarina = { ...asUser(fatima), allowedBranchIds: [String(branch['Dubai Marina']._id)], activeBranchId: String(branch['Dubai Marina']._id), addons: [] };
// A finished visit earlier today, ready for checkout
const visit = (salon, branchName, customer, line) => Appointment.create(appointmentDoc({ salon, branchName, customer, start: A.minus({ minutes: 165 }), lines: [line], status: 'COMPLETED', source: 'walk-in' }));
const bill = async (ctx, appointment, payments) => {
  const draft = await openDraft(ctx, { appointmentId: appointment._id });
  return issueInvoice(ctx, draft._id, { version: draft.version, payments }, key());
};
const serumSale = async (customer, qty, payments) => {
  let draft = await createSaleDraft(desk, { customerId: String(customer._id) });
  draft = await addProduct(desk, draft._id, { version: draft.version, skuId: String(sku.serum._id), qty });
  return issueInvoice(desk, draft._id, { version: draft.version, payments: payments(draft.grandTotal) }, key());
};

// Part paid: ₹1,000 now, the rest due. And one billed with nothing paid ("pay later").
await bill(desk, await visit(glamour, 'Andheri', gc['Priya Sharma'], [gs['Hair Colour'], staff.Rahul]), [{ method: 'UPI', amount: toPaise(1000), reference: 'UPI 4821' }]);
await bill(desk, await visit(glamour, 'Andheri', gc['Karan Malhotra'], [gs.Haircut, staff.Rahul]), []);
// An advance, to be used at checkout at any branch
await takeAdvance(desk, { customerId: String(gc['Sneha Kapoor']._id), method: 'UPI', amount: toPaise(2000), reference: 'UPI 7730', note: 'Bridal package deposit' }, key());
// Product sales: one serum returned (approved, with a GST credit note); another return waiting for the owner
const twoSerums = await serumSale(gc['Amit Verma'], 2, (total) => [{ method: 'CARD', amount: total, reference: 'Card ••4417' }]);
const asked = await createRefund(desk, { invoiceId: twoSerums._id, lines: [{ lineId: String(twoSerums.lines[0]._id), qty: 1, restock: 'SELLABLE' }], reason: 'Bought one too many', method: 'CARD' }, key());
await approveRefund(owner, asked.refund._id, {}, key());
const oneSerum = await serumSale(gc['Isha Patel'], 1, (total) => [{ method: 'CASH', amount: total }]);
await createRefund(desk, { invoiceId: oneSerum._id, lines: [{ lineId: String(oneSerum.lines[0]._id), qty: 1, restock: 'DAMAGED' }], reason: 'Bottle was cracked when opened at home', method: 'CASH' }, key());
// Desert Rose: a plain bill (not GST registered), paid in cash
await bill(atMarina, await visit(desertRose, 'Dubai Marina', desertCustomers[1], [ds.Haircut, staff.Omar]), [{ method: 'CASH', amount: ds.Haircut.price }]);

// GST setup, started but not activated, to try out: Glamour Studio's GSTINs are now dated registrations and the starter
// 5% rule waits for approval. One customer is a business from another state. Bills stay as they are until the owner activates.
await saveSetup(owner, { scheme: 'REGULAR', startMonth: now.setZone('Asia/Kolkata').toFormat('yyyy-MM') }, key());
// A part refund to look at: half of a haircut, by amount. Activating GST setup adds these bills to the tax record.
const halfRefunded = await bill(desk, await visit(glamour, 'Andheri', gc['Karan Malhotra'], [gs.Haircut, staff.Rahul]), [{ method: 'CASH', amount: gs.Haircut.price }]);
await createRefund(owner, { invoiceId: halfRefunded._id, lines: [{ lineId: String(halfRefunded.lines[0]._id), partAmount: Math.round(gs.Haircut.price / 2) }], reason: 'Customer only wanted half the cut redone' }, key());
await models.BillingSettings.updateOne({ orgId: glamour._id }, { $set: { 'branchOwners.viewGst': true } }); // Vikram can see GST for Bandra
// Purchases to try out: one bill that matches GSTR-2B and one that doesn't, and a GSTR-2B row that isn't in the books
const gstMonth = now.setZone('Asia/Kolkata').toFormat('yyyy-MM');
const billDay = now.setZone('Asia/Kolkata').toISODate();
const andheriGstin = demoGstin('27AAKCG4821M1Z');
const supplierGstin = demoGstin('27AABCS1429B1Z');
const demoBill = (billNumber, taxable, use) => addPurchase(owner, { gstin: andheriGstin, period: gstMonth, supplierName: 'Glow Salon Supplies', supplierGstin, billNumber, billDate: billDay, taxable: toPaise(taxable), igst: 0, cgst: toPaise(taxable * 0.09), sgst: toPaise(taxable * 0.09), use }, key());
await demoBill('GSS-009', 500, 'NO_ITC_SERVICES');
await demoBill('GSS-111', 1000, 'RESALE');
const demo2b = { data: { gstin: andheriGstin, rtnprd: now.setZone('Asia/Kolkata').toFormat('MMyyyy'), docdata: { b2b: [{ ctin: supplierGstin, trdnm: 'Glow Salon Supplies', inv: [
  { inum: 'GSS-009', dt: now.setZone('Asia/Kolkata').toFormat('dd-MM-yyyy'), val: 590, pos: '27', typ: 'R', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 500, igst: 0, cgst: 45, sgst: 45, cess: 0 }] },
  { inum: 'GSS-222', dt: now.setZone('Asia/Kolkata').toFormat('dd-MM-yyyy'), val: 236, pos: '27', typ: 'R', itcavl: 'Y', items: [{ num: 1, rt: 18, txval: 200, igst: 0, cgst: 18, sgst: 18, cess: 0 }] },
] }] } } };
await import2b(owner, { gstin: andheriGstin, period: gstMonth }, { originalname: 'GSTR2B-demo.json', buffer: Buffer.from(JSON.stringify(demo2b)) }, key());
await Customer.updateOne({ _id: gc['Amit Verma']._id }, { $set: { gstin: demoGstin('29AABCT3518Q1Z'), gstLegalName: 'Verma Traders LLP' } });

// Yesterday's cash days, counted and closed (Andheri was ₹50 short); today's are left for the desk to open
for (const [branchName, ctx, float, gap, note] of [['Andheri', desk, toPaise(3000), -toPaise(50), 'Gave change twice to one customer'], ['Dubai Marina', atMarina, toPaise(1500), 0, undefined]]) {
  await models.CashSession.create({ orgId: branch[branchName].orgId, branchId: branch[branchName]._id, day: at(branchName, -1, '00:00').toISODate(), openingFloat: float, openedBy: deskOf[branchName]._id, openedByName: deskOf[branchName].name, openedAt: at(branchName, -1, '09:30').toJSDate() });
  const { session } = await currentCashDay(ctx); // yesterday's day, with what the drawer should hold
  await closeCashDay(ctx, String(session._id), { countedCash: session.expectedCash + gap, note }, key());
}

// ===========================================================================
// 9. Birthday & Anniversary Offers. Months are worked out from today, so the demo always looks live.
//    Glamour Studio has the feature on; Desert Rose has it off.
// ===========================================================================
const occasionsOn = { ...anitaAtAndheri, occasionOffers: true };
const deskOccasions = { ...desk, occasionOffers: true };
await Organization.updateOne({ _id: glamour._id }, { $set: { 'occasionOffers.enabled': true, 'occasionOffers.enabledAt': new Date(), 'occasionOffers.enabledBy': anita._id } });
for (const input of [
  { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month Hair Spa', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: toPaise(500), minSubtotal: 0, serviceIds: [String(gs['Hair Spa']._id)] } },
  { type: 'ANNIVERSARY', scope: 'BUSINESS_DEFAULT', name: 'Anniversary Month Treat', rules: { discountType: 'FLAT', value: toPaise(300), minSubtotal: toPaise(1500), serviceIds: Object.values(gs).map((service) => String(service._id)) } },
]) {
  const { campaign } = await createCampaign(occasionsOn, input, key());
  await publishCampaign(occasionsOn, String(campaign._id), key());
}
// This month: Priya (birthday, WhatsApp allowed, to contact), Meera (birthday offer already used),
// Simran (anniversary, no permission: in-salon only, one call with no answer)
const occasion = (day) => ({ month: A.month, day, source: 'STAFF', updatedAt: new Date() });
await Customer.updateOne({ _id: gc['Priya Sharma']._id }, { $set: { 'occasions.birthday': occasion(Math.min(A.day + 3, 28)) } });
await Customer.updateOne({ _id: gc['Meera Nair']._id }, { $set: { homeBranchId: branch.Andheri._id, 'occasions.birthday': occasion(Math.max(A.day - 2, 1)) } });
const simran = await Customer.create({ orgId: glamour._id, name: 'Simran Kaur', phone: '9820011021', homeBranchId: branch.Andheri._id, occasions: { anniversary: occasion(Math.min(A.day + 5, 28)) } });
await recordConsent(deskOccasions, String(gc['Priya Sharma']._id), { channel: 'WHATSAPP', status: 'OPTED_IN', source: 'IN_SALON', agreed: true, customerAsked: true, note: 'Asked at the counter' }, key());
await migrateOccasions({ log: () => {} }); // permission "not recorded" for Simran
await runForOrg(glamour._id, { force: true, by: 'MANUAL' });
const simranOffer = await models.OfferIssue.findOne({ customerId: simran._id, type: 'ANNIVERSARY' }).lean();
await recordContact(deskOccasions, String(simranOffer._id), { outcome: 'NO_ANSWER' }, key());
// Meera came in for a Hair Spa and used her birthday offer
const meeraOffer = await models.OfferIssue.findOne({ customerId: gc['Meera Nair']._id, type: 'BIRTHDAY' }).lean();
const spaDraft = await openDraft(deskOccasions, { appointmentId: (await visit(glamour, 'Andheri', gc['Meera Nair'], [gs['Hair Spa'], staff.Neha]))._id });
const withOffer = await setInvoiceOffer(deskOccasions, spaDraft._id, { offerIssueId: String(meeraOffer._id), version: spaDraft.version });
await issueInvoice(deskOccasions, spaDraft._id, { version: withOffer.version, payments: [{ method: 'UPI', amount: withOffer.grandTotal, reference: 'UPI 5512' }] }, key());

// ===========================================================================
// 10. Email: a few emails already sent or failed, for Email → Recent emails and the bill page.
//     Saved as finished rows, so nothing is really sent.
// ===========================================================================
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const meeraBill = await models.Invoice.findById(spaDraft._id).select('invoiceNumber').lean();
const emailRow = (org, fields) => ({ orgId: org._id, html: '<p>Demo email</p>', text: 'Demo email', fromName: org.name, replyTo: org.contactEmail, attempts: 1, nextAttemptAt: fields.createdAt, ...fields });
const demoEmails = [
  emailRow(glamour, { kind: 'BILL', priority: 3, to: 'meera.nair@example.com', subject: `Your bill ${meeraBill.invoiceNumber} from Glamour Studio`, branchId: branch.Andheri._id, attachment: { type: 'INVOICE', id: spaDraft._id }, ref: { invoiceId: spaDraft._id }, dedupeKey: 'seed:bill', status: 'SENT', via: 'SMTP', createdAt: minutesAgo(90), sentAt: minutesAgo(89), createdBy: { id: kavya._id, name: kavya.name } }),
  emailRow(glamour, { kind: 'OCCASION_OFFER', priority: 4, to: 'priya.sharma@exmaple.com', subject: 'A birthday treat from Glamour Studio', branchId: branch.Andheri._id, dedupeKey: 'seed:offer-failed', status: 'FAILED', errorKind: 'BAD_ADDRESS', lastError: 'The email address isn’t valid.', errorDetail: 'Invalid email: priya.sharma@exmaple.com', createdAt: minutesAgo(60), createdBy: { id: kavya._id, name: kavya.name } }),
  emailRow(desertRose, { kind: 'TEST', priority: 2, to: 'owner@desertrose.com', subject: 'Test email from Desert Rose Salon', dedupeKey: 'seed:test', status: 'SENT', via: 'APPS_SCRIPT', createdAt: minutesAgo(200), sentAt: minutesAgo(200) }),
];
// Checked like any email, then saved as they are (so the demo times are kept)
for (const row of demoEmails) await new models.EmailOutbox(row).validate();
await models.EmailOutbox.collection.insertMany(demoEmails.map((row) => ({ ...row, updatedAt: row.sentAt ?? row.createdAt })));

// ===========================================================================
// Done
// ===========================================================================
const [customerCount, appointmentCount, billCount, offerCount] = await Promise.all([Customer.countDocuments(), Appointment.countDocuments(), Invoice.countDocuments(), models.OfferIssue.countDocuments()]);
console.log(`\nSeeded: 2 salons, 3 branches, ${Object.keys(staff).length} staff, ${GLAMOUR_SERVICES.length + DESERT_ROSE_SERVICES.length} services, 1 combo, ${customerCount} customers, ${LEADS.length} leads,`);
console.log(`        ${appointmentCount} appointments, ${billCount} bills, ${attendance.length} attendance records, ${Object.keys(sku).length} products, ${offerCount} offers, ${demoEmails.length} emails`);
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
