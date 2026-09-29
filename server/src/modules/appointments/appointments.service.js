import { Appointment, Branch } from '../../models/index.js';
import { OPEN_APPOINTMENT_STATUSES } from '../../config/constants.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { escapeRegex } from '../../utils/regex.js';
import { dayRangeUTC } from '../../utils/time.js';
import { APPOINTMENT_TRANSITIONS, assertTransition } from '../../utils/stateMachine.js';
import { bookWithLock, prepareBooking, withStaffLock } from './scheduling.service.js';

// Upcoming, still-open appointments that match `filter`, e.g. { branchId } or { 'items.staffId': id }.
// Used to stop an owner from archiving a branch or deactivating a stylist who still has bookings.
export async function findFutureBookings(ctx, filter) {
  const appointments = await Appointment.find(
    scoped(ctx, { ...filter, startAt: { $gte: new Date() }, status: { $in: OPEN_APPOINTMENT_STATUSES } })
  )
    .select('customerSnapshot startAt items.staffName branchId')
    .sort('startAt')
    .limit(20)
    .lean();

  // A short, readable summary for the UI
  return appointments.map((a) => ({
    _id: a._id,
    branchId: a.branchId,
    customerName: a.customerSnapshot.name,
    startAt: a.startAt,
    staffNames: [...new Set(a.items.map((item) => item.staffName))],
  }));
}

// Appointments at the selected branch, with optional filters
export async function listAppointments(ctx, { date, status, staffId, search }) {
  const filter = scoped(ctx, { branchId: ctx.activeBranchId });

  if (date) {
    // "28 Sep" means 28 Sep in the BRANCH's timezone
    const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).select('timezone').lean();
    const { start, end } = dayRangeUTC(date, branch.timezone);
    filter.startAt = { $gte: start, $lt: end };
  }
  if (status) filter.status = status;
  if (staffId) filter['items.staffId'] = staffId;
  if (search) {
    const digits = search.replace(/\D/g, '');
    filter.$or = [{ 'customerSnapshot.name': new RegExp(escapeRegex(search), 'i') }];
    if (digits.length >= 3) filter.$or.push({ 'customerSnapshot.phone': { $regex: digits } });
  }

  // One day: in time order. All dates: newest first.
  return Appointment.find(filter)
    .sort({ startAt: date ? 1 : -1 })
    .limit(200)
    .lean();
}

// One appointment, only if it's in this salon and in a branch this user may use
export async function getAppointment(ctx, id) {
  const appointment = await Appointment.findOne(scoped(ctx, { _id: id })).lean();
  if (!appointment || !ctx.allowedBranchIds.includes(String(appointment.branchId))) {
    throw new AppError(404, 'NOT_FOUND', 'Appointment not found');
  }
  return appointment;
}

export function createAppointment(ctx, input) {
  return bookWithLock(ctx, { ...input, branchId: ctx.activeBranchId });
}

// Edit or reschedule. Only allowed while the appointment is still Booked.
// Uses the same stylist lock and clash check as a new booking, ignoring its own current slot.
export async function updateAppointment(ctx, id, input) {
  const current = await getAppointment(ctx, id);
  if (current.status !== 'BOOKED') {
    throw new AppError(409, 'NOT_EDITABLE', 'Only booked appointments can be changed');
  }

  const { branch, items, comboId, totalPrice } = await prepareBooking(ctx, {
    ...input,
    branchId: current.branchId,
    customerId: current.customerId,
  });

  return withStaffLock(
    ctx,
    branch,
    items,
    async (session) => {
      // status: 'BOOKED' in the filter = only update if nobody changed its status meanwhile
      const updated = await Appointment.findOneAndUpdate(
        scoped(ctx, { _id: id, status: 'BOOKED' }),
        { $set: { items, startAt: items[0].startAt, endAt: items.at(-1).endAt, totalPrice, comboId: comboId ?? null, notes: input.notes } },
        { new: true, session }
      );
      if (!updated) throw new AppError(409, 'NOT_EDITABLE', 'This appointment was just changed by someone else. Please refresh.');
      return updated;
    },
    { excludeAppointmentId: id }
  );
}

// Move to the next status (Arrived, In service, Completed, Cancelled), following the fixed rules
export async function setAppointmentStatus(ctx, id, { status, reason }) {
  const current = await getAppointment(ctx, id);
  assertTransition(APPOINTMENT_TRANSITIONS, current.status, status);

  // Only update if the status is still what we just read. If two people click at once, one gets a clear error.
  const updated = await Appointment.findOneAndUpdate(
    scoped(ctx, { _id: id, status: current.status }),
    {
      $set: { status },
      $push: { statusHistory: { from: current.status, to: status, by: ctx.userId, at: new Date(), reason } },
    },
    { new: true }
  ).lean();

  if (!updated) throw new AppError(409, 'STATUS_CHANGED', 'This appointment was just updated by someone else. Please refresh.');
  return updated;
}
