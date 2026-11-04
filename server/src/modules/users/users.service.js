import { User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { generateTempPassword, hashPassword } from '../../utils/password.js';
import { assertAllowedBranches } from '../branches/branches.service.js';
import { emailPasswordLink, passwordEmailsAvailable } from '../auth/passwordLinks.service.js';
import { ONE_BRANCH_ROLES } from './users.schemas.js';

// Who can manage whom:
// - primary owner: every front desk and inventory login, and every branch owner
// - branch owner: only front desk and inventory logins in their own branches
function canManage(ctx, target) {
  if (String(target._id) === ctx.userId) return false; // not yourself
  if (target.role === 'OWNER') return ctx.isPrimaryOwner && !target.allBranches; // never the primary owner
  if (ONE_BRANCH_ROLES.includes(target.role)) return ctx.isPrimaryOwner || ctx.allowedBranchIds.includes(String(target.branchIds[0]));
  return false;
}

async function findManageableUser(ctx, id) {
  const user = await User.findOne(scoped(ctx, { _id: id }));
  if (!user || !canManage(ctx, user)) throw new AppError(404, 'NOT_FOUND', 'User not found');
  return user;
}

function checkBranchesForRole(ctx, role, branchIds) {
  if (ONE_BRANCH_ROLES.includes(role) && branchIds.length !== 1) {
    throw new AppError(400, 'VALIDATION_ERROR', 'This login works in exactly one branch');
  }
  assertAllowedBranches(ctx, branchIds);
}

export async function listUsers(ctx) {
  const filter = ctx.isPrimaryOwner
    ? scoped(ctx, { role: { $in: [...ONE_BRANCH_ROLES, 'OWNER'] }, allBranches: { $ne: true } })
    : scoped(ctx, { role: { $in: ONE_BRANCH_ROLES }, branchIds: { $in: ctx.allowedBranchIds } });

  return User.find(filter).populate('branchIds', 'name').sort({ role: 1, name: 1 }).lean();
}

// Creates the account with a temporary password, which is returned ONCE so the owner can share it.
// With sendPasswordEmail they get an email with a link to set their own password instead (nothing is shown).
export async function createUser(ctx, { sendPasswordEmail, ...input }) {
  if (sendPasswordEmail && !passwordEmailsAvailable()) {
    throw new AppError(409, 'MAIL_OFF', 'Email is off. Untick “Email them a link” to get a temporary password instead.');
  }
  if (input.role === 'OWNER' && !ctx.isPrimaryOwner) {
    throw new AppError(403, 'FORBIDDEN', 'Only the main owner can add other owners');
  }
  if (input.role === 'INVENTORY' && !ctx.addons.includes('inventory')) {
    throw new AppError(403, 'ADDON_DISABLED', 'Inventory is not switched on for your salon');
  }
  checkBranchesForRole(ctx, input.role, input.branchIds);

  if (await User.exists({ email: input.email })) {
    throw new AppError(409, 'EMAIL_TAKEN', 'A user with this email already exists');
  }

  const temporaryPassword = generateTempPassword();
  const user = await User.create({
    ...input,
    orgId: ctx.orgId,
    allBranches: false,
    passwordHash: await hashPassword(temporaryPassword),
  });

  if (sendPasswordEmail) {
    await emailPasswordLink(user, { _id: ctx.userId, name: ctx.userName });
    return { user: await user.populate('branchIds', 'name'), emailed: true };
  }
  return { user: await user.populate('branchIds', 'name'), temporaryPassword };
}

export async function updateUser(ctx, id, input) {
  const user = await findManageableUser(ctx, id);
  if (input.branchIds) checkBranchesForRole(ctx, user.role, input.branchIds);

  user.set(input);
  await user.save();
  return user.populate('branchIds', 'name');
}

export async function resetPassword(ctx, id) {
  const user = await findManageableUser(ctx, id);
  const temporaryPassword = generateTempPassword();
  user.passwordHash = await hashPassword(temporaryPassword);
  user.passwordChangedAt = new Date(); // logged out on their other devices
  await user.save();
  return { email: user.email, temporaryPassword };
}

// POST /api/users/:id/email-password-link — the same people an owner may reset; the link is never shown
export async function sendPasswordLink(ctx, id) {
  const user = await findManageableUser(ctx, id);
  return emailPasswordLink(user, { _id: ctx.userId, name: ctx.userName });
}

// A deactivated user is logged out on their next request (requireAuth checks status every time)
export async function setUserStatus(ctx, id, status) {
  const user = await findManageableUser(ctx, id);
  user.status = status;
  await user.save();
  return user.populate('branchIds', 'name');
}
