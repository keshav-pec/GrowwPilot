// Wipes the database and fills it with a small demo: 2 salons, 3 branches, a few weeks of history, a busy "today",
// payroll with last month paid, billing, a birthday offer, a couple of emails, and the Inventory add-on at
// Glamour Studio. Everything is settled: nothing waits for approval and nothing is overdue. Glamour Studio is
// GST registered, with GST setup left for the owner to do in GST → Settings (Save, then Activate).
// Today's appointments are placed around the CURRENT time, so the day board and dashboard always look alive.
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
import { issue } from '../modules/inventory/allocations/allocations.service.js';
import { createOrder, moveOrder, receiveOrder, submitOrder } from '../modules/inventory/purchasing/purchasing.service.js';
import { markSetupStep } from '../modules/inventory/setup/setup.service.js';
import { addImages } from '../modules/inventory/images/images.service.js';
import { addProduct, createSaleDraft, issueInvoice, openDraft } from '../modules/invoices/invoices.service.js';
import { closeCashDay, currentCashDay } from '../modules/cash/cash.service.js';
import { createCampaign, publishCampaign } from '../modules/occasions/campaigns/campaigns.service.js';
import { recordConsent } from '../modules/occasions/customers.service.js';
import { runForOrg } from '../modules/occasions/engine/scheduler.js';
import { migrateBilling } from './migrate-billing-v2.js';
import { migrateOccasions } from './migrate-occasions-v1.js';
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
const toBePaid = []; // { appointment, method }

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
// After closing time "now" is held inside opening hours (see anchor), so a booking meant to be coming up or in the chair
// may already be over: it is then saved as done and paid, so nothing looks late.
function addAppointment({ pay, ...details }) {
  let appointment = appointmentDoc(details);
  const over = { BOOKED: appointment.startAt, IN_SERVICE: appointment.endAt }[appointment.status];
  if (over && over <= new Date()) {
    appointment = appointmentDoc({ ...details, status: 'COMPLETED' });
    pay = { method: 'UPI' };
  }
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

// ----- 2a. History: the last few days, plus the same weekday 1 to 4 weeks ago for "revenue vs usual" -----
const PAY_METHODS = ['CASH', 'UPI', 'CARD'];
const customerInTurn = (d) => glamourCustomers[d % glamourCustomers.length];
for (const [i, d] of [1, 2, 3, 7, 14, 21, 28].entries()) {
  andheri({ customer: customerInTurn(d), start: at('Andheri', -d, '11:00'), lines: [[d % 2 ? gs.Haircut : gs['Hair Colour'], staff.Rahul]], status: 'COMPLETED', pay: { method: PAY_METHODS[i % 3] } });
}
for (const d of [1, 7]) {
  bandra({ customer: customerInTurn(d + 4), start: at('Bandra', -d, '13:00'), lines: [[gs.Haircut, staff.Arjun], [gs['Hair Spa'], staff.Arjun]], status: 'COMPLETED', pay: { method: 'CARD' } });
  marina({ customer: desertCustomers[d % 2], start: at('Dubai Marina', -d, '11:00'), lines: [[ds.Haircut, staff.Omar]], status: 'COMPLETED', pay: { method: 'CARD' } });
}

// ----- 2b. Today, around the current time: done and paid, in the chair, and coming up -----
const A = anchor('Andheri');
const B = anchor('Bandra');
const D = anchor('Dubai Marina');
const minutesFrom = (t, m) => t.plus({ minutes: m });
andheri({ customer: gc['Priya Sharma'], start: minutesFrom(A, -150), lines: [[gs['Hair Colour'], staff.Rahul]], status: 'COMPLETED', pay: { method: 'CARD' } });
andheri({ customer: gc['Amit Verma'], start: minutesFrom(A, -120), lines: [[gs.Facial, staff.Neha]], status: 'COMPLETED', pay: { method: 'UPI' } });
andheri({ customer: gc['Karan Malhotra'], start: minutesFrom(A, -50), lines: comboLines, comboDoc: combo, status: 'IN_SERVICE' });
const poojaLeadId = new ObjectId();
const poojaBooking = andheri({ customer: gc['Pooja Mehta'], start: minutesFrom(A, 30), lines: [[gs.Facial, staff.Neha], [gs['Hair Spa'], staff.Neha]], source: 'lead', leadId: poojaLeadId });
andheri({ customer: gc['Sneha Kapoor'], start: minutesFrom(A, 45), lines: [[gs['Hair Colour'], staff.Rahul]] });
bandra({ customer: gc['Isha Patel'], start: minutesFrom(B, -120), lines: [[gs.Haircut, staff.Arjun], [gs['Hair Spa'], staff.Arjun]], status: 'COMPLETED', pay: { method: 'CASH' } });
bandra({ customer: gc['Amit Verma'], start: minutesFrom(B, 15), lines: [[gs['Hair Colour'], staff.Arjun]] });
marina({ customer: desertCustomers[0], start: minutesFrom(D, -120), lines: [[ds.Haircut, staff.Omar]], status: 'COMPLETED', pay: { method: 'UPI' } });
marina({ customer: desertCustomers[1], start: minutesFrom(D, -75), lines: [[ds['Hair Colour'], staff.Omar]], status: 'IN_SERVICE' });
marina({ customer: desertCustomers[2], start: minutesFrom(D, 25), lines: [[ds['Hair Colour'], staff.Omar], [ds['Blow Dry'], staff.Omar]] });

// ----- 2c. Tomorrow -----
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
for (const { appointment, method } of toBePaid) {
  const name = branchNameOf(appointment.branchId);
  counters[name] = (counters[name] ?? 0) + 1;

  const invoice = {
    _id: new ObjectId(),
    orgId: appointment.orgId,
    branchId: appointment.branchId,
    appointmentId: appointment._id,
    customerId: appointment.customerId,
    invoiceNumber: `GP-${CODE[name]}-${String(counters[name]).padStart(6, '0')}`,
    lines: appointment.items.map((i) => ({ serviceName: i.serviceName, staffName: i.staffName, price: i.price })),
    subtotal: appointment.totalPrice,
    discount: 0,
    total: appointment.totalPrice,
    payments: [{ method, amount: appointment.totalPrice }],
    paidAt: new Date(+appointment.endAt + 3 * 60 * 1000),
    createdBy: appointment.createdBy,
  };
  appointment.invoiceId = invoice._id;
  invoices.push(invoice);
}

await Appointment.insertMany(appointments);
// Past bills are saved in the old shape, then moved onto the current bill records by the same migration real salons
// get. This is what lets them keep past dates (and numbers like GP-AND-000008; new bills start at AND/26-27/00001).
await Invoice.collection.insertMany(invoices);
await Counter.insertMany(Object.entries(counters).map(([name, seq]) => ({ _id: `invoice:${branch[name]._id}`, seq })));
await migrateBilling({ log: () => {} });
await migrateOccasions({ log: () => {} }); // home branches and "not recorded" permission for the demo customers

// Billing settings: Glamour Studio is GST registered in Maharashtra (prices include GST); Desert Rose isn't.
// Pressing Save in GST → Settings moves these GSTINs over.
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
// 5. Attendance: everyone present every day from the start of last month to today
// ===========================================================================
const attendance = [];
const mark = (branchName, person, days, status) => {
  const b = branch[branchName];
  const checkIn = status === 'present' && days <= 0 ? at(branchName, days, b.openTime).plus({ minutes: 5 + attendance.length % 10 }).toJSDate() : null;
  const checkOut = status === 'present' && days < 0 ? at(branchName, days, b.closeTime).minus({ minutes: 10 }).toJSDate() : null;
  attendance.push({ orgId: person.orgId, branchId: b._id, staffId: person._id, date: at(branchName, days, '00:00').toISODate(), status, checkInAt: checkIn, checkOutAt: checkOut, markedBy: deskOf[branchName]._id });
};
const team = { Andheri: [staff.Rahul, staff.Neha, staff.Kavya], Bandra: [staff.Arjun, staff.Ritu], 'Dubai Marina': [staff.Omar] };
for (const [branchName, people] of Object.entries(team)) {
  const today = at(branchName, 0, '00:00');
  const daysBack = Math.round(today.diff(today.minus({ months: 1 }).startOf('month'), 'days').days);
  for (let d = daysBack; d >= 0; d--) for (const person of people) mark(branchName, person, -d, 'present');
}
await Attendance.insertMany(attendance);

// ===========================================================================
// 6. Payroll, made through the real payroll rules: everyone has a pay setup from the start of last month,
//    last month is locked at every branch and paid in full, and this month is still running.
// ===========================================================================
// What tenantContext would build for a logged-in user
const branchesOfOrg = (orgId) => Object.values(branch).filter((b) => String(b.orgId) === String(orgId));
const asUser = (user) => ({
  orgId: String(user.orgId),
  userId: String(user._id),
  userName: user.name,
  role: user.role,
  isPrimaryOwner: user.role === 'OWNER' && user.allBranches,
  allowedBranchIds: (user.allBranches ? branchesOfOrg(user.orgId) : user.branchIds.map((id) => ({ _id: id }))).map((b) => String(b._id)),
});
const lastMonthStart = A.minus({ months: 1 }).startOf('month').toISODate();

await payroll.createPlan(asUser(anita), staff.Rahul._id, { model: 'FIXED_COMMISSION', monthlyBase: toPaise(22000), commissionBps: 1000, effectiveFrom: lastMonthStart });
await payroll.createPlan(asUser(anita), staff.Neha._id, { model: 'FIXED', monthlyBase: toPaise(18000), effectiveFrom: lastMonthStart });
await payroll.createPlan(asUser(anita), staff.Kavya._id, { model: 'FIXED', monthlyBase: toPaise(15000), effectiveFrom: lastMonthStart });
await payroll.createPlan(asUser(vikram), staff.Arjun._id, { model: 'HYBRID', dailyRate: toPaise(700), commissionBps: 800, effectiveFrom: lastMonthStart });
await payroll.createPlan(asUser(vikram), staff.Ritu._id, { model: 'DAILY', dailyRate: toPaise(600), effectiveFrom: lastMonthStart });
await payroll.createPlan(asUser(fatima), staff.Omar._id, { model: 'FIXED', monthlyBase: toPaise(9000), effectiveFrom: lastMonthStart });

const lastMonth = A.minus({ months: 1 }).toFormat('yyyy-MM');
for (const [user, branchName] of [[anita, 'Andheri'], [anita, 'Bandra'], [fatima, 'Dubai Marina']]) {
  const ctx = { ...asUser(user), activeBranchId: String(branch[branchName]._id) };
  await monthlyPayroll.lockRun(ctx, lastMonth);
  const paidOn = at(branchName, 0, '00:00').startOf('month').toISODate();
  for (const item of await models.PayrollItem.find({ branchId: branch[branchName]._id, month: lastMonth }).lean()) {
    if (item.net > 0) await salaryPayments.recordPayment(ctx, item._id, { amount: item.net, method: 'BANK', paidOn }, `seed-pay-${item._id}`);
  }
}

// ===========================================================================
// 7. Inventory add-on: Glamour Studio has it, set up at both branches; Desert Rose doesn't.
//    Made through the real inventory code, so every stock change is a movement in the history.
// ===========================================================================
await Organization.updateOne({ _id: glamour._id }, { $set: { 'addons.inventory.enabled': true, 'addons.inventory.enabledAt': new Date() } });
const suresh = await User.create({ orgId: glamour._id, role: 'INVENTORY', name: 'Suresh (Andheri stock)', email: 'inventory.andheri@glamour.com', passwordHash, branchIds: [branch.Andheri._id] });
const atBranch = (user, branchName) => ({ ...asUser(user), activeBranchId: String(branch[branchName]._id), allowedBranchIds: user.allBranches ? asUser(user).allowedBranchIds : [String(branch[branchName]._id)], addons: ['inventory'] });
const owner = atBranch(anita, 'Andheri');
const keeper = atBranch(suresh, 'Andheri');
const desk = atBranch(kavya, 'Andheri');
let seedKey = 0;
const key = () => `seed-${++seedKey}`; // a fresh Idempotency-Key for each change

const lakme = (await createSupplier(owner, { name: 'Lakme Pro Distributors', contactName: 'Sanjay', phone: '9819900011', paymentTerms: '30 days', leadTimeDays: 3 }, key())).supplier;

// Three products: one used in the salon, one a service uses, one for sale on bills
const product = async (input) => (await createSku(owner, input, key())).sku;
const sku = {
  shampoo: await product({ name: 'Loreal Shampoo 1L', category: 'Hair care', brand: 'Loreal', stockUnit: 'bottle', wayOfUse: 'FINISH', openingQty: 8, openingUnitCost: toPaise(650), reorderPoint: 3, reorderQty: 6, preferredSupplierId: String(lakme._id), barcodes: ['8901030703461'] }),
  facialKit: await product({ name: 'Gold facial kit', category: 'Skin', stockUnit: 'kit', wayOfUse: 'SERVICE_UNITS', openingQty: 12, openingUnitCost: toPaise(480), reorderPoint: 4, reorderQty: 10, preferredSupplierId: String(lakme._id) }),
  serum: await product({ name: 'Argan hair serum 100 ml', category: 'Retail', brand: 'Moroccanoil', type: 'RETAIL', stockUnit: 'bottle', wayOfUse: 'MANUAL', sellPrice: toPaise(1180), hsnCode: '3305', openingQty: 12, openingUnitCost: toPaise(620), reorderPoint: 3, reorderQty: 12, barcodes: ['8904099412001'] }),
};

// A facial takes one kit
await saveRecipe(owner, { serviceId: String(gs.Facial._id), scope: 'salon', lines: [{ skuId: String(sku.facialKit._id), qty: 1, deducts: true }] }, key());

// A shampoo bottle with Rahul, and an order from Lakme that has arrived in full
const mainStore = (await models.InventoryLocation.findOne({ branchId: branch.Andheri._id, isMain: true }).lean())._id;
await issue(keeper, { skuId: String(sku.shampoo._id), locationId: String(mainStore), recipient: { kind: 'STAFF', id: String(staff.Rahul._id) }, qty: 1 }, key());
const lakmeOrder = (await createOrder(owner, { supplierId: String(lakme._id), lines: [{ skuId: String(sku.shampoo._id), qty: 6, unitCost: toPaise(650) }], note: 'Monthly order' }, key())).order;
await submitOrder(owner, String(lakmeOrder._id), key());
await moveOrder(owner, String(lakmeOrder._id), 'order', {}, key());
const orderedLines = (await models.InventoryPurchaseOrder.findById(lakmeOrder._id).lean()).lines;
await receiveOrder(keeper, String(lakmeOrder._id), { invoiceNumber: 'LPD-20431', lines: [{ lineId: String(orderedLines[0]._id), qty: 6 }] }, key());

// Simple generated photos, so the catalogue has pictures
const photoOf = (label, colour) =>
  sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800"><rect width="800" height="800" fill="${colour}"/><text x="400" y="420" font-family="Arial, sans-serif" font-size="64" fill="#ffffff" text-anchor="middle">${label}</text></svg>`))
    .png()
    .toBuffer();
for (const [item, label, colour] of [[sku.shampoo, 'Shampoo', '#6b4226'], [sku.facialKit, 'Facial kit', '#c9a227'], [sku.serum, 'Hair serum', '#8a5a44']]) {
  await addImages(owner, String(item._id), [{ buffer: await photoOf(label, colour), originalname: `${item.code}.png` }], key());
}
for (const branchName of ['Andheri', 'Bandra']) {
  await markSetupStep(atBranch(anita, branchName), 'locations', key());
  await markSetupStep(atBranch(anita, branchName), 'done', key());
}

// ===========================================================================
// 8. Billing, made through the real billing code, like a day at the desk: a visit checked out and a product sold,
//    both paid in full. Then yesterday's cash days, counted and closed.
// ===========================================================================
const atMarina = { ...asUser(fatima), activeBranchId: String(branch['Dubai Marina']._id), addons: [] };
const meeraVisit = await Appointment.create(appointmentDoc({ salon: glamour, branchName: 'Andheri', customer: gc['Meera Nair'], start: minutesFrom(A, -60), lines: [[gs['Hair Spa'], staff.Neha]], status: 'COMPLETED', source: 'walk-in' }));
const meeraDraft = await openDraft(desk, { appointmentId: meeraVisit._id });
const meeraBill = await issueInvoice(desk, meeraDraft._id, { version: meeraDraft.version, payments: [{ method: 'UPI', amount: meeraDraft.grandTotal, reference: 'UPI 5512' }] }, key());
let serumDraft = await createSaleDraft(desk, { customerId: String(gc['Priya Sharma']._id) });
serumDraft = await addProduct(desk, serumDraft._id, { version: serumDraft.version, skuId: String(sku.serum._id), qty: 1 });
await issueInvoice(desk, serumDraft._id, { version: serumDraft.version, payments: [{ method: 'CARD', amount: serumDraft.grandTotal, reference: 'Card ••4417' }] }, key());
await models.BillingSettings.updateOne({ orgId: glamour._id }, { $set: { 'branchOwners.viewGst': true } }); // Vikram can see GST for Bandra

// Yesterday's cash days, counted and closed with the drawer matching; today's are left for the desk to open
for (const [branchName, ctx, float] of [['Andheri', desk, toPaise(3000)], ['Dubai Marina', atMarina, toPaise(1500)]]) {
  await models.CashSession.create({ orgId: branch[branchName].orgId, branchId: branch[branchName]._id, day: at(branchName, -1, '00:00').toISODate(), openingFloat: float, openedBy: deskOf[branchName]._id, openedByName: deskOf[branchName].name, openedAt: at(branchName, -1, '09:30').toJSDate() });
  const { session } = await currentCashDay(ctx); // yesterday's day, with what the drawer should hold
  await closeCashDay(ctx, String(session._id), { countedCash: session.expectedCash }, key());
}

// ===========================================================================
// 9. Birthday Offers. Months are worked out from today, so the demo always looks live.
//    Glamour Studio has the feature on; Desert Rose has it off.
// ===========================================================================
const occasionsOn = { ...asUser(anita), activeBranchId: String(branch.Andheri._id), occasionOffers: true };
const deskOccasions = { ...desk, occasionOffers: true };
await Organization.updateOne({ _id: glamour._id }, { $set: { 'occasionOffers.enabled': true, 'occasionOffers.enabledAt': new Date(), 'occasionOffers.enabledBy': anita._id } });
const { campaign } = await createCampaign(occasionsOn, { type: 'BIRTHDAY', scope: 'BUSINESS_DEFAULT', name: 'Birthday Month Hair Spa', rules: { discountType: 'PERCENT', value: 1500, maxDiscount: toPaise(500), minSubtotal: 0, serviceIds: [String(gs['Hair Spa']._id)] } }, key());
await publishCampaign(occasionsOn, String(campaign._id), key());
// Priya's birthday is in a few days and she is happy to hear about it on WhatsApp
await Customer.updateOne({ _id: gc['Priya Sharma']._id }, { $set: { 'occasions.birthday': { month: A.month, day: Math.min(A.day + 3, 28), source: 'STAFF', updatedAt: new Date() } } });
await recordConsent(deskOccasions, String(gc['Priya Sharma']._id), { channel: 'WHATSAPP', status: 'OPTED_IN', source: 'IN_SALON', agreed: true, customerAsked: true, note: 'Asked at the counter' }, key());
await runForOrg(glamour._id, { force: true, by: 'MANUAL' });

// ===========================================================================
// 10. Email: two emails already sent, for Email → Recent emails and the bill page.
//     Saved as finished rows, so nothing is really sent.
// ===========================================================================
const minutesAgo = (m) => new Date(Date.now() - m * 60_000);
const emailRow = (org, fields) => ({ orgId: org._id, html: '<p>Demo email</p>', text: 'Demo email', fromName: org.name, replyTo: org.contactEmail, attempts: 1, nextAttemptAt: fields.createdAt, ...fields });
const demoEmails = [
  emailRow(glamour, { kind: 'BILL', priority: 3, to: 'meera.nair@example.com', subject: `Your bill ${meeraBill.invoiceNumber} from Glamour Studio`, branchId: branch.Andheri._id, attachment: { type: 'INVOICE', id: meeraBill._id }, ref: { invoiceId: meeraBill._id }, dedupeKey: 'seed:bill', status: 'SENT', via: 'SMTP', createdAt: minutesAgo(2), sentAt: minutesAgo(1), createdBy: { id: kavya._id, name: kavya.name } }),
  emailRow(desertRose, { kind: 'TEST', priority: 2, to: 'owner@desertrose.com', subject: 'Test email from Desert Rose Salon', dedupeKey: 'seed:test', status: 'SENT', via: 'APPS_SCRIPT', createdAt: minutesAgo(200), sentAt: minutesAgo(200) }),
];
// Checked like any email, then saved as they are (so the demo times are kept)
for (const row of demoEmails) await new models.EmailOutbox(row).validate();
await models.EmailOutbox.collection.insertMany(demoEmails.map((row) => ({ ...row, updatedAt: row.sentAt ?? row.createdAt })));

// ===========================================================================
// Done
// ===========================================================================
const [customerCount, appointmentCount, billCount] = await Promise.all([Customer.countDocuments(), Appointment.countDocuments(), Invoice.countDocuments()]);
console.log(`\nSeeded: 2 salons, 3 branches, ${Object.keys(staff).length} staff, ${GLAMOUR_SERVICES.length + DESERT_ROSE_SERVICES.length} services, 1 combo, ${customerCount} customers, ${LEADS.length} leads,`);
console.log(`        ${appointmentCount} appointments, ${billCount} bills, ${Object.keys(sku).length} products, ${demoEmails.length} emails`);
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
