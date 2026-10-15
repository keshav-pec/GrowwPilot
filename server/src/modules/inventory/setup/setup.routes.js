import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { getSetup, markSetupStep } from './setup.service.js';

// /api/inventory/setup — the first-time setup guide for the selected branch
const router = Router();

router.get('/', async (req, res) => {
  res.json(await getSetup(req.ctx));
});
router.post('/steps', requireIdempotencyKey, validate({ body: z.object({ step: z.enum(['locations', 'done']) }) }), async (req, res) => {
  res.json(await markSetupStep(req.ctx, req.valid.body.step, req.idempotencyKey));
});

export default router;
