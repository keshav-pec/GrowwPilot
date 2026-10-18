import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { objectId } from '../../utils/schemas.js';
import { paymentsSchema } from '../invoices/invoices.schemas.js';
import { recordPayments } from './payments.service.js';

// /api/payments — money taken on a bill after it was issued (owners and front desk)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

const recordSchema = z.object({ invoiceId: objectId, payments: paymentsSchema.min(1, 'Add at least one payment') });

router.post('/', requireIdempotencyKey, validate({ body: recordSchema }), async (req, res) => {
  res.status(201).json({ invoice: await recordPayments(req.ctx, req.valid.body, req.idempotencyKey) });
});

export default router;
