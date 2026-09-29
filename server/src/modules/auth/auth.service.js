import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { Branch, Organization, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';

export const COOKIE_NAME = 'gp_token';
const SESSION_DAYS = 7;

// httpOnly: JavaScript in the browser can't read the cookie (protects against XSS stealing it)
// secure: only sent over HTTPS in production
export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  maxAge: SESSION_DAYS * 24 * 60 * 60 * 1000,
};

// The token only holds the user's id. Everything else is loaded fresh from the DB on each request.
export function signToken(userId) {
  return jwt.sign({ userId: String(userId) }, env.JWT_SECRET, { expiresIn: `${SESSION_DAYS}d` });
}

export function verifyToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET);
  } catch {
    throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');
  }
}

// Throws if the user, or their salon, has been deactivated. Returns the user's organization.
export async function assertCanLogIn(user) {
  if (user.status !== 'active') {
    throw new AppError(401, 'ACCOUNT_INACTIVE', 'Your account has been deactivated');
  }
  if (user.role === 'SUPER_ADMIN') return null;

  const org = await Organization.findById(user.orgId).select('name status').lean();
  if (!org || org.status !== 'active') {
    throw new AppError(401, 'ORG_INACTIVE', 'This salon has been deactivated. Please contact GrowwPilot support.');
  }
  return org;
}

export async function login({ email, password }) {
  const user = await User.findOne({ email }).select('+passwordHash');

  // Same message for "no such email" and "wrong password", so nobody can find out which emails exist
  const passwordOk = user && (await bcrypt.compare(password, user.passwordHash));
  if (!passwordOk) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password');
  }

  const org = await assertCanLogIn(user);
  return { user, org };
}

// The active branches this user may work in:
// - primary owner (allBranches): every branch of the salon
// - branch owner / front desk: only the branches listed on their account
export async function getAllowedBranches(user) {
  if (user.role === 'SUPER_ADMIN') return [];

  const filter = { orgId: user.orgId, status: 'active' };
  if (!(user.role === 'OWNER' && user.allBranches)) {
    filter._id = { $in: user.branchIds };
  }
  return Branch.find(filter).select('name city timezone openTime closeTime defaultServiceMinutes').sort('name').lean();
}

// What the frontend receives about the logged-in user (never the password hash)
export function toSessionUser(user, org, branches) {
  return {
    _id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    allBranches: user.allBranches,
    org: org ? { _id: org._id, name: org.name } : null,
    branches,
  };
}
