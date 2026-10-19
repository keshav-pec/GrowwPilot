import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { PAYMENT_METHODS } from '../../config/constants.js';
import { objectId, paise } from '../../utils/schemas.js';
import { customerAdvances, takeAdvance } from './payments.service.js';

// /api/advances — money a customer pays ahead (owners and front desk)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

const takeSchema = z.object({
  customerId: objectId,
  method: z.enum(PAYMENT_METHODS),
  amount: paise.min(100, 'At least ₹1'),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(200).optional(),
});

router.get('/', validate({ query: z.object({ customerId: objectId }) }), async (req, res) => {
  res.json(await customerAdvances(req.ctx, req.valid.query.customerId));
});
router.post('/', requireIdempotencyKey, validate({ body: takeSchema }), async (req, res) => {
  res.status(201).json(await takeAdvance(req.ctx, req.valid.body, req.idempotencyKey));
});

export default router;
