import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { objectId } from '../../../utils/schemas.js';
import * as service from './stockCounts.service.js';

// /api/inventory/stock-counts
const router = Router();
const once = requireIdempotencyKey;
const note = z.string().trim().max(300).optional();

const saveSchema = z.object({
  lines: z.array(z.object({ lineId: objectId, counted: z.number().int('Use a whole number').min(0).nullable(), reason: z.string().trim().max(200).optional() })).min(1).max(5000),
});

router.get('/', async (req, res) => {
  res.json(await service.getCounts(req.ctx));
});
router.post('/', once, async (req, res) => {
  res.status(201).json(await service.startCount(req.ctx, req.idempotencyKey));
});
router.patch('/:id', validate({ body: saveSchema }), async (req, res) => {
  res.json(await service.saveCounts(req.ctx, req.params.id, req.valid.body));
});
router.post('/:id/submit', once, async (req, res) => {
  res.json(await service.submitCount(req.ctx, req.params.id, req.idempotencyKey));
});
router.post('/:id/approve', once, validate({ body: z.object({ note }) }), async (req, res) => {
  res.json(await service.approveCount(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/:id/send-back', once, validate({ body: z.object({ note: z.string().trim().min(3, 'Say what to check').max(300) }) }), async (req, res) => {
  res.json(await service.sendBackCount(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/:id/cancel', once, async (req, res) => {
  res.json(await service.cancelCount(req.ctx, req.params.id, req.idempotencyKey));
});

export default router;
