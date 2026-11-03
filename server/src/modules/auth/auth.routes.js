import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { validate } from '../../middleware/validate.js';
import { requireAuth } from '../../middleware/auth.js';
import { AppError } from '../../utils/AppError.js';
import { checkLinkSchema, forgotPasswordSchema, loginSchema, resetPasswordSchema } from './auth.schemas.js';
import { PASSWORD_RULE, checkLink, passwordEmailsAvailable, requestReset, resetWithLink } from './passwordLinks.service.js';
import * as controller from './auth.controller.js';

// At most 10 failed logins per IP every 15 minutes (slows down password guessing)
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  skipSuccessfulRequests: true, // only failed attempts count
  handler: (req, res, next) =>
    next(new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many login attempts. Please try again in 15 minutes.')),
});

// "Forgot password?": at most 5 requests per IP every 15 minutes (each person also gets at most 3 emails an hour)
const forgotLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many requests. Please try again in 15 minutes.')),
});
// Using a password link (stops guessing links)
const linkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  handler: (req, res, next) => next(new AppError(429, 'TOO_MANY_ATTEMPTS', 'Too many attempts. Please try again in 15 minutes.')),
});

const router = Router();

router.post('/login', loginLimiter, validate({ body: loginSchema }), controller.login);
// No login needed: whether "Forgot password?" can work (email set up), and the password rule
router.get('/options', (req, res) => res.json({ passwordEmails: passwordEmailsAvailable(), passwordRule: PASSWORD_RULE }));
router.post('/forgot-password', forgotLimiter, validate({ body: forgotPasswordSchema }), (req, res) => res.json(requestReset(req.valid.body.email)));
router.post('/reset-password/check', linkLimiter, validate({ body: checkLinkSchema }), async (req, res) => res.json(await checkLink(req.valid.body.token)));
router.post('/reset-password', linkLimiter, validate({ body: resetPasswordSchema }), async (req, res) => {
  res.json(await resetWithLink(req.valid.body.token, req.valid.body.password));
});
router.post('/logout', controller.logout);
router.get('/me', requireAuth, controller.me);

export default router;
