// The booking engine: builds the appointment's items, checks the rules, and saves it
// without double-booking a stylist (even when two desks click "Book" at the same moment).
import mongoose from 'mongoose';
import { DateTime } from 'luxon';
import { Appointment, Attendance, Branch, Combo, Customer, Service, Staff } from '../../models/index.js';
import { OPEN_APPOINTMENT_STATUSES } from '../../config/constants.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatTime, localToUTC, toBranchTime } from '../../utils/time.js';

const SLOT_STEP_MINUTES = 15;
const PAST_GRACE_MINUTES = 5; // a booking may start up to 5 minutes ago (e.g. a walk-in right now)
const ABSENT_STATUSES = ['absent', 'leave'];

const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60 * 1000);
const sameId = (a, b) => String(a) === String(b);

// ---------------------------------------------------------------------------
// Step 1: load everything the request refers to, ALWAYS inside this salon (orgId).
// Another salon's ids simply aren't found, so they can't sneak into a booking.
// ---------------------------------------------------------------------------
async function loadBookingRefs(ctx, payload) {
  if (!ctx.allowedBranchIds.includes(String(payload.branchId))) {
    throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  }
  const branch = await Branch.findOne(scoped(ctx, { _id: payload.branchId, status: 'active' })).lean();
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');

  const customer = await Customer.findOne(scoped(ctx, { _id: payload.customerId })).lean();
  if (!customer) throw new AppError(404, 'NOT_FOUND', 'Customer not found');

  // Services: active, in this salon, and offered at this branch (empty branchIds = every branch)
  const serviceIds = payload.items.map((item) => item.serviceId);
  const services = await Service.find(scoped(ctx, { _id: { $in: serviceIds }, status: 'active' })).lean();
  for (const id of serviceIds) {
    const service = services.find((s) => sameId(s._id, id));
    if (!service) throw new AppError(400, 'INVALID_SERVICE', 'One of the services is not available');
    if (service.branchIds.length > 0 && !service.branchIds.some((b) => sameId(b, branch._id))) {
      throw new AppError(400, 'INVALID_SERVICE', `${service.name} is not offered at ${branch.name}`);
    }
  }

  // Staff: must exist in this salon (whether they can be booked is checked later)
  const staffIds = payload.items.map((item) => item.staffId);
  const staff = await Staff.find(scoped(ctx, { _id: { $in: staffIds } })).lean();
  for (const id of staffIds) {
    if (!staff.some((s) => sameId(s._id, id))) throw new AppError(400, 'INVALID_STAFF', 'One of the stylists was not found');
  }

  // Combo (optional): the items must be exactly the combo's services
  let combo = null;
  if (payload.comboId) {
    combo = await Combo.findOne(scoped(ctx, { _id: payload.comboId, status: 'active' })).lean();
    if (!combo) throw new AppError(400, 'INVALID_COMBO', 'This combo is not available');
    if (combo.branchIds.length > 0 && !combo.branchIds.some((b) => sameId(b, branch._id))) {
      throw new AppError(400, 'INVALID_COMBO', `${combo.name} is not offered at ${branch.name}`);
    }
    const sorted = (ids) => ids.map(String).sort().join(',');
    if (sorted(combo.serviceIds) !== sorted(serviceIds)) {
      throw new AppError(400, 'INVALID_COMBO', `The services don't match the ${combo.name} combo`);
    }
  }

  // One "line" per item: the service, the chosen stylist and an optional custom duration
  const lines = payload.items.map((item) => ({
    service: services.find((s) => sameId(s._id, item.serviceId)),
    staff: staff.find((s) => sameId(s._id, item.staffId)),
    durationMinutes: item.durationMinutes,
  }));

  return { branch, customer, combo, lines };
}

// ---------------------------------------------------------------------------
// Step 2: turn the lines into appointment items, back to back, in UTC,
// with a copy (snapshot) of the service name, stylist name and price.
// ---------------------------------------------------------------------------
export function buildItems(branch, lines, startAt) {
  let cursor = startAt;

  return lines.map(({ service, staff, durationMinutes }) => {
    // Duration: what the front desk typed, else the service's duration, else the branch default
    const duration = durationMinutes ?? service.durationMinutes ?? branch.defaultServiceMinutes;
    const item = {
      serviceId: service._id,
      serviceName: service.name,
      staffId: staff._id,
      staffName: staff.name,
      startAt: cursor,
      endAt: addMinutes(cursor, duration),
      durationMinutes: duration,
      price: service.price,
    };
    cursor = item.endAt; // the next item starts when this one ends
    return item;
  });
}

// ---------------------------------------------------------------------------
// Step 3: rule checks
// ---------------------------------------------------------------------------

// The whole booking must fit inside the branch's opening hours (in the branch's own timezone)
export function assertWithinOpeningHours(branch, items) {
  const zone = branch.timezone;
  const start = toBranchTime(items[0].startAt, zone);
  const end = toBranchTime(items.at(-1).endAt, zone);
  const opens = DateTime.fromISO(`${start.toISODate()}T${branch.openTime}`, { zone });
  const closes = DateTime.fromISO(`${start.toISODate()}T${branch.closeTime}`, { zone });

  if (start < opens || end > closes) {
    throw new AppError(
      400,
      'OUTSIDE_HOURS',
      `${branch.name} is open ${opens.toFormat('h:mm a')} to ${closes.toFormat('h:mm a')}. This booking runs ${start.toFormat('h:mm a')} to ${end.toFormat('h:mm a')}.`
    );
  }
}

// Each stylist must be active, work at this branch, and not be marked absent or on leave that day
export async function assertStaffBookable(branch, lines, items) {
  const date = toBranchTime(items[0].startAt, branch.timezone).toISODate();

  for (const { staff } of lines) {
    if (staff.status !== 'active') {
      throw new AppError(400, 'STAFF_UNAVAILABLE', `${staff.name} is not active and can't be booked`);
    }
    if (!sameId(staff.branchId, branch._id)) {
      throw new AppError(400, 'STAFF_UNAVAILABLE', `${staff.name} doesn't work at ${branch.name}`);
    }
  }

  const absence = await Attendance.findOne({
    staffId: { $in: lines.map((line) => line.staff._id) },
    date,
    status: { $in: ABSENT_STATUSES },
  }).lean();
  if (absence) {
    const name = lines.find((line) => sameId(line.staff._id, absence.staffId)).staff.name;
    throw new AppError(400, 'STAFF_UNAVAILABLE', `${name} is marked ${absence.status} on that day`);
  }
}

// ---------------------------------------------------------------------------
// Step 4: find clashes with other bookings.
// Overlap rule: existing.start < new.end AND existing.end > new.start
// (so 2:00–2:45 and 2:45–3:30 do NOT clash: back to back is fine)
// ---------------------------------------------------------------------------
export async function findConflicts(ctx, items, { session, excludeAppointmentId } = {}) {
  const filter = scoped(ctx, {
    status: { $in: OPEN_APPOINTMENT_STATUSES }, // cancelled or completed bookings don't block anyone
    $or: items.map((item) => ({
      items: { $elemMatch: { staffId: item.staffId, startAt: { $lt: item.endAt }, endAt: { $gt: item.startAt } } },
    })),
  });
  if (excludeAppointmentId) filter._id = { $ne: excludeAppointmentId }; // when rescheduling, ignore its own old slot

  const query = Appointment.find(filter).lean();
  if (session) query.session(session);
  const existing = await query;

  // Work out exactly which existing items clash, for a clear error message
  const conflicts = [];
  for (const item of items) {
    for (const appointment of existing) {
      for (const other of appointment.items) {
        const clash = sameId(other.staffId, item.staffId) && other.startAt < item.endAt && other.endAt > item.startAt;
        if (clash) {
          conflicts.push({ appointmentId: appointment._id, staffName: other.staffName, startAt: other.startAt, endAt: other.endAt });
        }
      }
    }
  }
  return conflicts;
}

// "Rahul is already booked from 2:00 PM to 2:45 PM"
function conflictMessage(conflicts, zone) {
  const lines = conflicts.map((c) => `${c.staffName} is already booked from ${formatTime(c.startAt, zone)} to ${formatTime(c.endAt, zone)}`);
  return [...new Set(lines)].join('. ');
}

// ---------------------------------------------------------------------------
// Steps 1–3 together: everything that can be checked before touching the database.
// payload: { branchId, customerId, date: '2026-09-28', startTime: '14:30',
//            items: [{ serviceId, staffId, durationMinutes? }], comboId? }
// ---------------------------------------------------------------------------
export async function prepareBooking(ctx, payload) {
  const { branch, customer, combo, lines } = await loadBookingRefs(ctx, payload);

  const startAt = localToUTC(payload.date, payload.startTime, branch.timezone);
  if (startAt < addMinutes(new Date(), -PAST_GRACE_MINUTES)) {
    throw new AppError(400, 'PAST_TIME', 'This time has already passed');
  }

  const items = buildItems(branch, lines, startAt);
  assertWithinOpeningHours(branch, items);
  await assertStaffBookable(branch, lines, items);

  return {
    branch,
    customer,
    items,
    comboId: combo?._id,
    // A combo has its own (discounted) price; otherwise add up the services
    totalPrice: combo ? combo.comboPrice : items.reduce((sum, item) => sum + item.price, 0),
  };
}

// ---------------------------------------------------------------------------
// The concurrency-safe part. Inside ONE transaction:
//   1. "Lock" each stylist by changing their Staff document (scheduleVersion + 1).
//      MongoDB won't let two open transactions change the same document, so if two desks book
//      Rahul at the same moment, the second one gets a write conflict and is retried automatically.
//   2. Check for overlapping bookings. On the retry, the second desk now SEES the first booking -> 409.
//   3. Save (write(session) creates or updates the appointment).
// Result: the first booking to commit wins; the other desk gets a clear "already booked" message.
// ---------------------------------------------------------------------------
export function withStaffLock(ctx, branch, items, write, { excludeAppointmentId } = {}) {
  const staffIds = [...new Set(items.map((item) => String(item.staffId)))];

  return mongoose.connection.transaction(async (session) => {
    await Staff.updateMany({ _id: { $in: staffIds } }, { $inc: { scheduleVersion: 1 } }, { session });

    const conflicts = await findConflicts(ctx, items, { session, excludeAppointmentId });
    if (conflicts.length > 0) {
      throw new AppError(409, 'SLOT_TAKEN', conflictMessage(conflicts, branch.timezone), conflicts);
    }

    return write(session);
  });
}

// Book a new appointment
export async function bookWithLock(ctx, payload) {
  const { branch, customer, items, comboId, totalPrice } = await prepareBooking(ctx, payload);

  return withStaffLock(ctx, branch, items, async (session) => {
    const [appointment] = await Appointment.create(
      [
        {
          orgId: ctx.orgId,
          branchId: branch._id,
          customerId: customer._id,
          customerSnapshot: { name: customer.name, phone: customer.phone },
          items,
          comboId,
          startAt: items[0].startAt,
          endAt: items.at(-1).endAt,
          totalPrice,
          status: 'BOOKED',
          statusHistory: [{ to: 'BOOKED', by: ctx.userId }],
          source: payload.source ?? 'phone',
          leadId: payload.leadId,
          notes: payload.notes,
          createdBy: ctx.userId,
        },
      ],
      { session }
    );
    return appointment;
  });
}

// ---------------------------------------------------------------------------
// Free start times for one stylist on one day, in 15-minute steps (branch local time).
// This only HELPS the front desk pick a time; bookWithLock still makes the final decision.
// ---------------------------------------------------------------------------
export async function getAvailability(ctx, { date, staffId, duration, excludeAppointmentId }) {
  const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).lean();
  const staff = await Staff.findOne(scoped(ctx, { _id: staffId, branchId: ctx.activeBranchId })).lean();
  if (!branch || !staff) throw new AppError(404, 'NOT_FOUND', 'Stylist not found at this branch');

  const zone = branch.timezone;
  const minutes = duration ?? branch.defaultServiceMinutes;
  const result = { date, timezone: zone, staffId, duration: minutes, slots: [] };

  if (staff.status !== 'active') return { ...result, reason: `${staff.name} is not active` };
  const absence = await Attendance.findOne({ staffId, date, status: { $in: ABSENT_STATUSES } }).lean();
  if (absence) return { ...result, reason: `${staff.name} is marked ${absence.status} on this day` };

  const opens = DateTime.fromISO(`${date}T${branch.openTime}`, { zone });
  const closes = DateTime.fromISO(`${date}T${branch.closeTime}`, { zone });

  // This stylist's existing bookings that day
  const appointments = await Appointment.find(
    scoped(ctx, {
      status: { $in: OPEN_APPOINTMENT_STATUSES },
      'items.staffId': staffId,
      startAt: { $lt: closes.toJSDate() },
      endAt: { $gt: opens.toJSDate() },
      ...(excludeAppointmentId && { _id: { $ne: excludeAppointmentId } }),
    })
  ).lean();
  const busy = appointments.flatMap((a) => a.items.filter((item) => sameId(item.staffId, staffId)));

  const earliest = DateTime.now().minus({ minutes: PAST_GRACE_MINUTES });
  for (let start = opens; start.plus({ minutes }) <= closes; start = start.plus({ minutes: SLOT_STEP_MINUTES })) {
    if (start < earliest) continue; // already in the past
    const end = start.plus({ minutes });
    const clash = busy.some((item) => item.startAt < end.toJSDate() && item.endAt > start.toJSDate());
    if (!clash) result.slots.push(start.toFormat('HH:mm'));
  }
  return result;
}
