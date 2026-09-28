import { AppError } from '../utils/AppError.js';
import { getAllowedBranches } from '../modules/auth/auth.service.js';

// Builds req.ctx: WHO is asking and WHICH salon and branches they may touch.
// orgId always comes from the logged-in user, never from the URL or request body.
// Must run after requireAuth.
export async function tenantContext(req, res, next) {
  const user = req.user;

  const branches = await getAllowedBranches(user);
  const allowedBranchIds = branches.map((b) => String(b._id));

  if (user.role !== 'SUPER_ADMIN' && allowedBranchIds.length === 0) {
    throw new AppError(403, 'NO_BRANCH', 'You are not assigned to any active branch');
  }

  // The branch picked in the branch switcher. It must be one the user is allowed to use.
  // Front desk users only have one allowed branch, so they are always locked to it.
  const requested = req.get('X-Branch-Id');
  if (requested && !allowedBranchIds.includes(requested)) {
    throw new AppError(403, 'BRANCH_FORBIDDEN', 'You do not have access to this branch');
  }

  req.ctx = {
    userId: String(user._id),
    role: user.role,
    orgId: user.orgId ? String(user.orgId) : null,
    isPrimaryOwner: user.role === 'OWNER' && user.allBranches,
    allowedBranchIds,
    activeBranchId: requested || allowedBranchIds[0] || null,
  };
  next();
}
