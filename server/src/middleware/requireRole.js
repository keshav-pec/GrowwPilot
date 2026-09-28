import { AppError } from '../utils/AppError.js';

// Only lets the listed roles through. Usage: requireRole('OWNER') or requireRole('OWNER', 'FRONT_DESK')
export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      throw new AppError(403, 'FORBIDDEN', 'You do not have permission to do this');
    }
    next();
  };
}
