import mongoose from 'mongoose';
import { Appointment, Branch, Customer, Invoice, Staff } from '../../models/index.js';
import { OPEN_APPOINTMENT_STATUSES, SERVICE_STAFF } from '../../config/constants.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { escapeRegex } from '../../utils/regex.js';
import { customerOccasionChanges, logCustomerChange } from '../occasions/customers.service.js';

// ---------------------------------------------------------------------------
// Visits, spend and last visit are CALCULATED from appointments and invoices every time.
// We never store counters on the customer, so the numbers can't drift out of sync.
//   visits     = number of Completed appointments
//   last visit = start time of the latest Completed appointment
//   spend      = sum of issued bill totals, less refunds (cancelled bookings, drafts and voided bills never count)
// ---------------------------------------------------------------------------
export async function getCustomerStats(ctx, customerIds) {
  // aggregate() doesn't convert strings to ObjectIds for us, so we do it here
  const orgId = new mongoose.Types.ObjectId(ctx.orgId);
  const ids = customerIds.map((id) => new mongoose.Types.ObjectId(String(id)));

  const [visits, spend] = await Promise.all([
    Appointment.aggregate([
      { $match: { orgId, customerId: { $in: ids }, status: 'COMPLETED' } },
      { $group: { _id: '$customerId', totalVisits: { $sum: 1 }, lastVisitAt: { $max: '$startAt' } } },
    ]),
    Invoice.aggregate([
      { $match: { orgId, customerId: { $in: ids }, status: 'ISSUED' } },
      { $group: { _id: '$customerId', totalSpend: { $sum: { $subtract: ['$grandTotal', { $ifNull: ['$creditedTotal', 0] }] } } } },
    ]),
  ]);

  // { customerId: { totalVisits, lastVisitAt, totalSpend } }, with zeros for customers who have none yet
  const stats = {};
  for (const id of ids) stats[id] = { totalVisits: 0, lastVisitAt: null, totalSpend: 0 };
  for (const v of visits) Object.assign(stats[v._id], { totalVisits: v.totalVisits, lastVisitAt: v.lastVisitAt });
  for (const s of spend) stats[s._id].totalSpend = s.totalSpend;
  return stats;
}

// Search by name or phone, one page at a time. Each row also gets its visit numbers.
export async function listCustomers(ctx, { search, page, limit }) {
  const filter = scoped(ctx);
  if (search) {
    const digits = search.replace(/\D/g, '');
    filter.$or = [{ name: new RegExp(escapeRegex(search), 'i') }];
    if (digits.length >= 3) filter.$or.push({ phone: { $regex: digits } });
  }

  const [customers, total] = await Promise.all([
    Customer.find(filter)
      .sort({ name: 1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    Customer.countDocuments(filter),
  ]);

  const stats = await getCustomerStats(ctx, customers.map((c) => c._id));
  return {
    customers: customers.map((c) => ({ ...c, ...stats[c._id] })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / limit)),
  };
}

async function findCustomer(ctx, id) {
  const customer = await Customer.findOne(scoped(ctx, { _id: id }));
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');
  return customer;
}

// The preferred stylist must be a (non-archived) stylist of this salon
async function assertPreferredStaff(ctx, staffId) {
  if (!staffId) return;
  const exists = await Staff.exists(scoped(ctx, { _id: staffId, status: { $ne: 'archived' }, ...SERVICE_STAFF }));
  if (!exists) throw new AppError(400, 'INVALID_STAFF', 'That stylist was not found');
}

// Turns form values into what we save: '' means "clear this field".
// Birthday, anniversary and home branch are handled by customerOccasionChanges (occasions module).
function toDocument(input) {
  const { birthday, anniversary, homeBranchId, ...doc } = input;
  if ('preferredStaffId' in input) doc.preferredStaffId = input.preferredStaffId || null;
  return doc;
}

// The activity row when a form changed a birthday or anniversary (the home branch alone isn't logged for new customers)
async function logDateChange(ctx, customer, words, before, session) {
  await logCustomerChange(ctx, customer, { action: 'occasions.dates_changed', summary: `Changed ${customer.name}’s details: ${words.join('; ')}`, before }, session);
}

// One phone number = one customer per salon
async function assertPhoneFree(ctx, phone, exceptId) {
  const filter = scoped(ctx, { phone });
  if (exceptId) filter._id = { $ne: exceptId };
  const existing = await Customer.findOne(filter).lean();
  if (existing) {
    throw new AppError(409, 'CUSTOMER_EXISTS', `Existing customer found: ${existing.name}`, { customer: existing });
  }
}

// If the phone already exists we don't create a duplicate: we return 409 with the existing
// customer, so the screen can link to them instead.
// A new customer's home branch is the branch they were added at, unless one is chosen.
export async function createCustomer(ctx, input) {
  await assertPhoneFree(ctx, input.phone);
  await assertPreferredStaff(ctx, input.preferredStaffId);
  return mongoose.connection.transaction(async (session) => {
    const occasionInput = { birthday: input.birthday, anniversary: input.anniversary, homeBranchId: input.homeBranchId ?? ctx.activeBranchId };
    const { set, words } = await customerOccasionChanges(ctx, {}, occasionInput, session);
    const customer = new Customer({ ...toDocument(input), orgId: ctx.orgId });
    customer.set(set);
    await customer.save({ session });
    if (input.birthday || input.anniversary) await logDateChange(ctx, customer, words, null, session);
    return customer;
  });
}

export async function updateCustomer(ctx, id, input) {
  const customer = await findCustomer(ctx, id);
  if (input.phone && input.phone !== customer.phone) await assertPhoneFree(ctx, input.phone, id);
  await assertPreferredStaff(ctx, input.preferredStaffId);

  return mongoose.connection.transaction(async (session) => {
    const before = customer.toObject();
    const { set, words } = await customerOccasionChanges(ctx, before, input, session);
    customer.set(toDocument(input));
    customer.set(set);
    await customer.save({ session });
    if (words.length > 0) await logDateChange(ctx, customer, words, { occasions: before.occasions, homeBranchId: before.homeBranchId }, session);
    return customer;
  });
}

// Profile page: details, calculated numbers, and upcoming / past appointments (from every branch)
export async function getCustomerProfile(ctx, id) {
  const customer = await Customer.findOne(scoped(ctx, { _id: id }))
    .populate('preferredStaffId', 'name branchId status')
    .lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');

  const [stats, appointments, branches] = await Promise.all([
    getCustomerStats(ctx, [customer._id]),
    Appointment.find(scoped(ctx, { customerId: customer._id })).sort({ startAt: -1 }).limit(100).lean(),
    Branch.find(scoped(ctx)).select('name timezone').lean(),
  ]);

  // Add the branch name and timezone so each appointment shows in its own branch's time
  const branchById = Object.fromEntries(branches.map((b) => [b._id, b]));
  const withBranch = appointments.map((a) => ({
    ...a,
    branchName: branchById[a.branchId]?.name,
    branchTimezone: branchById[a.branchId]?.timezone,
  }));

  // Upcoming = still open and in the future. Everything else is past.
  const now = new Date();
  const isUpcoming = (a) => OPEN_APPOINTMENT_STATUSES.includes(a.status) && a.startAt >= now;

  return {
    customer: { ...customer, homeBranchName: branchById[customer.homeBranchId]?.name ?? null },
    stats: stats[customer._id],
    upcoming: withBranch.filter(isUpcoming).reverse(), // soonest first
    past: withBranch.filter((a) => !isUpcoming(a)), // latest first
  };
}
