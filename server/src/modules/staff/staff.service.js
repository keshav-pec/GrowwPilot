import { Staff } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { assertAllowedBranches } from '../branches/branches.service.js';
import { findFutureBookings } from '../appointments/appointments.service.js';

// Loads one staff member, but only if they are in this salon AND in a branch this user may use
async function findStaff(ctx, id) {
  const staff = await Staff.findOne(scoped(ctx, { _id: id }));
  if (!staff || !ctx.allowedBranchIds.includes(String(staff.branchId))) {
    throw new AppError(404, 'NOT_FOUND', 'Staff member not found');
  }
  return staff;
}

// Staff of the branch picked in the branch switcher (front desk: always their own branch)
export function listStaff(ctx) {
  return Staff.find(scoped(ctx, { branchId: ctx.activeBranchId })).sort({ status: 1, name: 1 }).lean();
}

export function createStaff(ctx, input) {
  assertAllowedBranches(ctx, [input.branchId]);
  return Staff.create({ ...input, orgId: ctx.orgId });
}

export async function updateStaff(ctx, id, input) {
  const staff = await findStaff(ctx, id);

  // Moving a stylist to another branch would leave their bookings at the old branch without a stylist
  if (input.branchId && input.branchId !== String(staff.branchId)) {
    assertAllowedBranches(ctx, [input.branchId]);
    const bookings = await findFutureBookings(ctx, { 'items.staffId': staff._id });
    if (bookings.length > 0) {
      throw new AppError(409, 'HAS_FUTURE_BOOKINGS', `${staff.name} has upcoming bookings at this branch. Reassign them first.`, bookings);
    }
  }

  staff.set(input);
  return staff.save();
}

// Activate, deactivate or archive. If the stylist still has future bookings, the owner must confirm first.
export async function setStaffStatus(ctx, id, { status, confirm }) {
  const staff = await findStaff(ctx, id);

  if (status !== 'active' && !confirm) {
    const bookings = await findFutureBookings(ctx, { 'items.staffId': staff._id });
    if (bookings.length > 0) {
      throw new AppError(
        409,
        'HAS_FUTURE_BOOKINGS',
        `${staff.name} has ${bookings.length} upcoming booking(s). They will show in "Requires attention" so you can reassign them.`,
        bookings
      );
    }
  }

  staff.status = status;
  return staff.save();
}
