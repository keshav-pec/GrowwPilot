import { Router } from 'express';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { correctSchema, writeOffSchema } from './movements.schemas.js';
import * as service from './movements.service.js';

// /api/inventory/movements — stock changes recorded by hand, and corrections
const router = Router();

router.post('/write-offs', requireIdempotencyKey, validate({ body: writeOffSchema }), async (req, res) => {
  res.status(201).json(await service.writeOff(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/:id/correct', requireIdempotencyKey, validate({ body: correctSchema }), async (req, res) => {
  res.json(await service.correctFinish(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
