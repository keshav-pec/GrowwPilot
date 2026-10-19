import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { recordPaymentSchema } from '../invoices/invoices.schemas.js';
import { recordPayments, reversePayment } from './payments.service.js';

// /api/payments — money taken on a bill after it was issued, and reversing a wrong one (owners)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

const reverseSchema = z.object({ reason: z.string().trim().min(3, 'Say why the payment is reversed').max(300) });

router.post('/', requireIdempotencyKey, validate({ body: recordPaymentSchema }), async (req, res) => {
  res.status(201).json({ invoice: await recordPayments(req.ctx, req.valid.body, req.idempotencyKey) });
});
router.post('/:id/reverse', requireIdempotencyKey, validate({ body: reverseSchema }), async (req, res) => {
  res.json(await reversePayment(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
