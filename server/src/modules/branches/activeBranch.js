import { Branch } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';

// The branch picked in the branch switcher (tenantContext has already checked it's one of the user's)
export async function activeBranch(ctx, session = null) {
  const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).session(session).lean();
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return branch;
}
