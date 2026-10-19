import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { PAYMENT_METHODS } from '../../config/constants.js';
import { RESTOCK_OPTIONS } from '../../config/billing.js';
import { objectId } from '../../utils/schemas.js';
import { approveRefund, createRefund, getRefund, quoteRefund, rejectRefund } from './refunds.service.js';

// /api/refunds — refunds and returns on issued bills. Front desk asks; owners approve (see refunds.service.js)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

const lines = z
  .array(z.object({ lineId: objectId, qty: z.number().int().min(1).max(999), restock: z.enum(RESTOCK_OPTIONS).optional() }))
  .min(1, 'Choose what is being refunded')
  .max(50);
const quoteSchema = z.object({ invoiceId: objectId, lines });
const createSchema = z.object({
  invoiceId: objectId,
  lines,
  reason: z.string().trim().min(3, 'Say why it is being refunded').max(300),
  method: z.enum(PAYMENT_METHODS).default('CASH'),
  reference: z.string().trim().max(100).optional(),
});
const approveSchema = z.object({ method: z.enum(PAYMENT_METHODS).optional(), reference: z.string().trim().max(100).optional() });
const rejectSchema = z.object({ note: z.string().trim().min(2, 'Say why the refund is turned down').max(300) });

router.post('/quote', validate({ body: quoteSchema }), async (req, res) => {
  res.json(await quoteRefund(req.ctx, req.valid.body));
});
router.post('/', requireIdempotencyKey, validate({ body: createSchema }), async (req, res) => {
  res.status(201).json(await createRefund(req.ctx, req.valid.body, req.idempotencyKey));
});
router.get('/:id', async (req, res) => {
  res.json(await getRefund(req.ctx, req.params.id));
});
router.post('/:id/approve', requireIdempotencyKey, validate({ body: approveSchema }), async (req, res) => {
  res.json(await approveRefund(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/:id/reject', requireIdempotencyKey, validate({ body: rejectSchema }), async (req, res) => {
  res.json(await rejectRefund(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
