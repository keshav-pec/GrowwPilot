import { Branch } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { findFutureBookings } from '../appointments/appointments.service.js';

// Throws unless every id is a branch this user may work in.
// Used whenever a request names branches (staff's branch, a service's branches, a user's branches).
export function assertAllowedBranches(ctx, branchIds) {
  const bad = branchIds.filter((id) => !ctx.allowedBranchIds.includes(String(id)));
  if (bad.length > 0) {
    throw new AppError(400, 'INVALID_BRANCH', 'One or more branches are not valid for your salon');
  }
}

// The primary owner sees every branch, including archived ones (so they can restore them).
// Everyone else sees only the active branches they are allowed to use.
export function listBranches(ctx) {
  const filter = ctx.isPrimaryOwner ? scoped(ctx) : scoped(ctx, { _id: { $in: ctx.allowedBranchIds } });
  return Branch.find(filter).sort({ status: 1, name: 1 }).lean();
}

export async function getBranch(ctx, id) {
  const canSee = ctx.isPrimaryOwner || ctx.allowedBranchIds.includes(id);
  // Another salon's branch, or one this user isn't allowed to see, is simply "not found"
  const branch = canSee ? await Branch.findOne(scoped(ctx, { _id: id })).lean() : null;
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return branch;
}

export function createBranch(ctx, input) {
  return Branch.create({ ...input, orgId: ctx.orgId });
}

export async function updateBranch(ctx, id, input) {
  const branch = await Branch.findOne(scoped(ctx, { _id: id }));
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');

  branch.set(input);
  if (branch.openTime >= branch.closeTime) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Closing time must be after opening time');
  }
  return branch.save();
}

// Archive ("soft delete") or restore a branch
export async function setBranchStatus(ctx, id, status) {
  const branch = await Branch.findOne(scoped(ctx, { _id: id }));
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');

  if (status === 'archived') {
    const otherActive = await Branch.countDocuments(scoped(ctx, { _id: { $ne: id }, status: 'active' }));
    if (otherActive === 0) {
      throw new AppError(409, 'LAST_BRANCH', 'You cannot archive your only active branch');
    }

    const bookings = await findFutureBookings(ctx, { branchId: id });
    if (bookings.length > 0) {
      throw new AppError(409, 'HAS_FUTURE_BOOKINGS', 'This branch still has upcoming bookings. Move or cancel them first.', bookings);
    }
  }

  branch.status = status;
  return branch.save();
}
