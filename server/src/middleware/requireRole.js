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

// Only the primary owner (the one who sees all branches). Must run after tenantContext.
export function requirePrimaryOwner(req, res, next) {
  if (!req.ctx.isPrimaryOwner) {
    throw new AppError(403, 'FORBIDDEN', 'Only the main owner can do this');
  }
  next();
}
