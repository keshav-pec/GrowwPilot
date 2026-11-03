import express, { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { unsubscribe, unsubscribePage, unsubscribeState } from './unsubscribe.js';

// /api/public/unsubscribe/<token> — no login. GET shows the page with the Unsubscribe button; POST does it.
// POST also takes Gmail's one-click unsubscribe (List-Unsubscribe-Post), which sends a small form body.
const router = Router();
router.use(rateLimit({ windowMs: 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false }));
router.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
});

router.get('/:token', async (req, res) => {
  const result = await unsubscribeState(req.params.token);
  res.status(result.state === 'INVALID' ? 404 : 200).type('html').send(unsubscribePage(result));
});

router.post('/:token', express.urlencoded({ extended: false, limit: '1kb' }), async (req, res) => {
  const result = await unsubscribe(req.params.token);
  res.status(result.state === 'INVALID' ? 404 : 200).type('html').send(unsubscribePage(result));
});

export default router;
