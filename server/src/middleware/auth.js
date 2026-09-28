import { User } from '../models/index.js';
import { AppError } from '../utils/AppError.js';
import { COOKIE_NAME, assertCanLogIn, verifyToken } from '../modules/auth/auth.service.js';

// Checks the login cookie and loads the user from the database.
// The user is loaded on EVERY request, so a deactivated user or salon is locked out immediately.
export async function requireAuth(req, res, next) {
  const token = req.cookies[COOKIE_NAME];
  if (!token) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in');

  try {
    const { userId } = verifyToken(token);
    const user = await User.findById(userId).lean();
    if (!user) throw new AppError(401, 'UNAUTHENTICATED', 'Please log in again');

    req.org = await assertCanLogIn(user);
    req.user = user;
    next();
  } catch (err) {
    // Any login problem: remove the cookie so the browser is logged out
    res.clearCookie(COOKIE_NAME);
    throw err;
  }
}
