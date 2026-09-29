import { DateTime } from 'luxon';
import { Appointment, Attendance, Branch, Staff } from '../../models/index.js';
import { OPEN_APPOINTMENT_STATUSES } from '../../config/constants.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { dayRangeUTC, localToUTC, todayInZone } from '../../utils/time.js';

async function activeBranch(ctx) {
  return Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).select('name timezone').lean();
}

// The day's roster for the selected branch: every active stylist, with that day's record (or null = not marked yet)
export async function listAttendance(ctx, { date }) {
  const branch = await activeBranch(ctx);
  const day = date ?? todayInZone(branch.timezone); // "today" means today at the branch

  const [staff, records] = await Promise.all([
    Staff.find(scoped(ctx, { branchId: branch._id, status: { $ne: 'archived' } })).select('name role status').sort('name').lean(),
    Attendance.find(scoped(ctx, { branchId: branch._id, date: day })).lean(),
  ]);

  const rows = staff
    .map((s) => ({ staff: s, attendance: records.find((r) => String(r.staffId) === String(s._id)) ?? null }))
    // Inactive stylists only show up if they already have a record that day
    .filter((row) => row.staff.status === 'active' || row.attendance);

  return { date: day, timezone: branch.timezone, rows };
}

// Mark one stylist present / absent / on leave for one day (creates or updates the record: an "upsert")
export async function markAttendance(ctx, { staffId, date, status, checkIn, checkOut }) {
  const staff = await Staff.findOne(scoped(ctx, { _id: staffId })).lean();
  if (!staff || !ctx.allowedBranchIds.includes(String(staff.branchId))) throw new AppError(404, 'NOT_FOUND', 'Staff member not found');
  const branch = await Branch.findById(staff.branchId).select('timezone').lean();

  const update = { orgId: ctx.orgId, branchId: staff.branchId, status, markedBy: ctx.userId };
  if (status === 'present') {
    // "14:05" at the branch -> a UTC time. '' or null clears it. Not sent = keep what's saved.
    const existing = await Attendance.findOne(scoped(ctx, { staffId, date })).lean();
    const toUTC = (t) => (t ? localToUTC(date, t, branch.timezone) : null);
    update.checkInAt = checkIn !== undefined ? toUTC(checkIn) : (existing?.checkInAt ?? null);
    update.checkOutAt = checkOut !== undefined ? toUTC(checkOut) : (existing?.checkOutAt ?? null);
    if (update.checkInAt && update.checkOutAt && update.checkOutAt <= update.checkInAt) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Check-out must be after check-in');
    }
  } else {
    // Absent or on leave: there are no check-in / check-out times
    update.checkInAt = null;
    update.checkOutAt = null;
  }

  // One record per stylist per day (unique index on staffId + date)
  const attendance = await Attendance.findOneAndUpdate(scoped(ctx, { staffId, date }), { $set: update }, { upsert: true, new: true, runValidators: true });

  // Absent with bookings already made that day: tell the screen. These bookings also show up in
  // the owner's "Requires attention" list so someone reassigns them.
  let affectedBookings = [];
  if (status !== 'present') {
    const { start, end } = dayRangeUTC(date, branch.timezone);
    const bookings = await Appointment.find(
      scoped(ctx, { 'items.staffId': staffId, status: { $in: OPEN_APPOINTMENT_STATUSES }, startAt: { $gte: start, $lt: end } })
    )
      .select('customerSnapshot.name startAt')
      .sort('startAt')
      .lean();
    affectedBookings = bookings.map((b) => ({ _id: b._id, customerName: b.customerSnapshot.name, startAt: b.startAt }));
  }

  return { attendance, affectedBookings };
}

// Owner view: for each stylist, how many days they were present / absent / on leave in a month
export async function monthlySummary(ctx, { month }) {
  const branch = await activeBranch(ctx);
  const first = DateTime.fromISO(`${month}-01`, { zone: branch.timezone });
  const today = DateTime.now().setZone(branch.timezone).startOf('day');

  // Days that could have been marked: the whole month, or up to today for the current month
  const lastDay = first.endOf('month') < today ? first.endOf('month') : today;
  const daysSoFar = lastDay < first ? 0 : Math.floor(lastDay.diff(first, 'days').days) + 1;

  const [staff, records] = await Promise.all([
    Staff.find(scoped(ctx, { branchId: branch._id, status: { $ne: 'archived' } })).select('name role status').sort('name').lean(),
    // Dates are "YYYY-MM-DD" text, so text comparison picks the whole month
    Attendance.find(scoped(ctx, { branchId: branch._id, date: { $gte: `${month}-01`, $lte: `${month}-31` } })).lean(),
  ]);

  const rows = staff.map((s) => {
    const mine = records.filter((r) => String(r.staffId) === String(s._id));
    const count = (status) => mine.filter((r) => r.status === status && r.date <= lastDay.toISODate()).length;
    const present = count('present');
    const absent = count('absent');
    const leave = count('leave');
    return { staff: s, present, absent, leave, notMarked: Math.max(daysSoFar - present - absent - leave, 0) };
  });

  return { month, daysSoFar, rows };
}
