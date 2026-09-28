import { Branch } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';

// Branches the logged-in user may access
export function listBranches(ctx) {
  return Branch.find(scoped(ctx, { _id: { $in: ctx.allowedBranchIds } }))
    .sort('name')
    .lean();
}

export async function getBranch(ctx, id) {
  // Another salon's branch, or one this user isn't allowed to see, is simply "not found"
  const branch = ctx.allowedBranchIds.includes(id) ? await Branch.findOne(scoped(ctx, { _id: id })).lean() : null;
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return branch;
}
