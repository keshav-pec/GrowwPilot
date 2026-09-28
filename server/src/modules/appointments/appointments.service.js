import { Appointment } from '../../models/index.js';
import { OPEN_APPOINTMENT_STATUSES } from '../../config/constants.js';
import { scoped } from '../../utils/scoped.js';

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
