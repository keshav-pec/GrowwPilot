import { Staff, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { assertAllowedBranches } from '../branches/branches.service.js';
import { findFutureBookings } from '../appointments/appointments.service.js';

// Loads one staff member, but only if they are in this salon AND in a branch this user may use
export async function findStaff(ctx, id) {
  const staff = await Staff.findOne(scoped(ctx, { _id: id }));
  if (!staff || !ctx.allowedBranchIds.includes(String(staff.branchId))) {
    throw new AppError(404, 'NOT_FOUND', 'Staff member not found');
  }
  return staff;
}

// Same, but stylists only. Payroll uses this until front desk pay is added (Payroll Part 6).
export async function findServiceStaff(ctx, id) {
  const staff = await findStaff(ctx, id);
  if (staff.kind === 'FRONT_DESK') throw new AppError(404, 'NOT_FOUND', 'Staff member not found');
  return staff;
}

// Staff of the branch picked in the branch switcher (front desk: always their own branch)
export function listStaff(ctx) {
  return Staff.find(scoped(ctx, { branchId: ctx.activeBranchId })).sort({ status: 1, name: 1 }).lean();
}

// A front desk member can be linked to one front desk login of the same branch.
// Stylists never have a login, so switching to SERVICE removes the link.
async function checkLinkedLogin(ctx, { kind, branchId, userId }, staffId = null) {
  if (!userId) return;
  if (kind !== 'FRONT_DESK') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Only front desk members can be linked to a login');
  }
  const user = await User.findOne(scoped(ctx, { _id: userId, role: 'FRONT_DESK' })).lean();
  if (!user) throw new AppError(400, 'INVALID_USER', 'That front desk login was not found');
  if (!user.branchIds.some((b) => String(b) === String(branchId))) {
    throw new AppError(400, 'INVALID_USER', `${user.name}'s login is for a different branch`);
  }
  const taken = await Staff.findOne(scoped(ctx, { userId, _id: { $ne: staffId } })).select('name').lean();
  if (taken) throw new AppError(409, 'LOGIN_TAKEN', `${user.name}'s login is already linked to ${taken.name}`);
}

export async function createStaff(ctx, input) {
  assertAllowedBranches(ctx, [input.branchId]);
  const doc = { kind: 'SERVICE', ...input, userId: input.userId || null };
  await checkLinkedLogin(ctx, doc);
  return Staff.create({ ...doc, orgId: ctx.orgId });
}

export async function updateStaff(ctx, id, input) {
  const staff = await findStaff(ctx, id);
  const next = {
    kind: input.kind ?? staff.kind,
    branchId: input.branchId ?? String(staff.branchId),
    userId: 'userId' in input ? input.userId : staff.userId,
  };
  if (next.kind === 'SERVICE') next.userId = null;

  // A stylist moving to the front desk can't keep their bookings (front desk members are never booked)
  if (next.kind === 'FRONT_DESK' && staff.kind !== 'FRONT_DESK') {
    const bookings = await findFutureBookings(ctx, { 'items.staffId': staff._id });
    if (bookings.length > 0) {
      throw new AppError(409, 'HAS_FUTURE_BOOKINGS', `${staff.name} has upcoming bookings. Reassign them before moving them to the front desk.`, bookings);
    }
  }
  await checkLinkedLogin(ctx, next, staff._id);

  // Moving a stylist to another branch would leave their bookings at the old branch without a stylist
  if (input.branchId && input.branchId !== String(staff.branchId)) {
    assertAllowedBranches(ctx, [input.branchId]);
    const bookings = await findFutureBookings(ctx, { 'items.staffId': staff._id });
    if (bookings.length > 0) {
      throw new AppError(409, 'HAS_FUTURE_BOOKINGS', `${staff.name} has upcoming bookings at this branch. Reassign them first.`, bookings);
    }
  }

  staff.set({ ...input, userId: next.userId || null });
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
