import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../utils/AppError.js';
import { loginSchema } from './auth.schemas.js';
import * as controller from './auth.controller.js';

// At most 10 failed logins per IP every 15 minutes (slows down password guessing)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true, // only failed attempts count
  handler: (req, res, next) =>
    next(new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many login attempts. Please try again in 15 minutes.')),
});

const router = Router();

router.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
router.post('/logout', controller.logout);
router.get('/me', requireAuth, controller.me);

export default router;
