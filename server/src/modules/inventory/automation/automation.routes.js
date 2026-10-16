import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import * as service from './automation.service.js';

// /api/inventory/automation — automatic use by services: exceptions, failed events, corrections
const router = Router();
const once = requireIdempotencyKey;

router.get('/', async (req, res) => {
  res.json(await service.listAutomation(req.ctx));
});
router.post('/exceptions/:id/post', once, async (req, res) => {
  res.json(await service.postException(req.ctx, req.params.id, req.idempotencyKey));
});
router.post('/exceptions/:id/dismiss', once, validate({ body: z.object({ note: z.string().trim().min(3, 'Say why').max(300) }) }), async (req, res) => {
  res.json(await service.dismissException(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/events/:id/retry', async (req, res) => {
  res.json(await service.retryEvent(req.ctx, req.params.id));
});
router.post(
  '/uses/:id/correct',
  once,
  validate({ body: z.object({ actualQty: z.number().int('Use a whole number').min(0), note: z.string().trim().max(300).optional() }) }),
  async (req, res) => {
    res.json(await service.correctServiceUse(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
  }
);

export default router;
