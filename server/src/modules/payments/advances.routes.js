import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { PAYMENT_METHODS } from '../../config/constants.js';
import { objectId, paise } from '../../utils/schemas.js';
import { customerAdvances, getAdvance, giveBackAdvance, quoteAdvance, takeAdvance } from './payments.service.js';
import { advancePdfName, writeAdvancePdf } from './advance.pdf.js';

// /api/advances — money a customer pays ahead (owners and front desk)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

const takeSchema = z.object({
  customerId: objectId,
  method: z.enum(PAYMENT_METHODS),
  amount: paise.min(100, 'At least ₹1'),
  reference: z.string().trim().max(100).optional(),
  note: z.string().trim().max(200).optional(),
  forServiceIds: z.array(objectId).max(20).optional(), // an advance for these services: taxed now, with a receipt voucher
  billId: objectId.optional(), // this money is for a bill already issued
});
const quoteSchema = z.object({ amount: paise.min(100, 'At least ₹1'), forServiceIds: z.array(objectId).min(1, 'Choose a service').max(20) });
const giveBackSchema = z.object({
  amount: paise.min(1, 'Enter an amount'),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(100).optional(),
  reason: z.string().trim().min(3, 'Say why it is being given back').max(300),
});

router.get('/', validate({ query: z.object({ customerId: objectId }) }), async (req, res) => {
  res.json(await customerAdvances(req.ctx, req.valid.query.customerId));
});
router.post('/', requireIdempotencyKey, validate({ body: takeSchema }), async (req, res) => {
  res.status(201).json(await takeAdvance(req.ctx, req.valid.body, req.idempotencyKey));
});

router.post('/quote', validate({ body: quoteSchema }), async (req, res) => {
  res.json(await quoteAdvance(req.ctx, req.valid.body));
});
router.get('/:id', async (req, res) => {
  res.json(await getAdvance(req.ctx, req.params.id));
});
router.get('/:id/pdf', async (req, res) => {
  const data = await getAdvance(req.ctx, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${advancePdfName(data.advance)}"`);
  writeAdvancePdf(res, data);
});
router.post('/:id/give-back', requireIdempotencyKey, validate({ body: giveBackSchema }), async (req, res) => {
  res.json(await giveBackAdvance(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
