import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { paise } from '../../utils/schemas.js';
import { addPettyCash, adjustCashDay, closeCashDay, currentCashDay, openCashDay } from './cash.service.js';

// /api/cash-sessions — the daily cash drawer at the selected branch (owners and front desk; see cash.service.js)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

const reason = z.string().trim().min(3, 'Say what it was for').max(200);
const openSchema = z.object({ openingFloat: paise });
const pettySchema = z.object({ kind: z.enum(['PETTY_IN', 'PETTY_OUT']), amount: paise.min(1, 'More than ₹0'), reason });
const closeSchema = z.object({ countedCash: paise, note: z.string().trim().max(300).optional(), version: z.number().int().min(0).optional() });
const adjustSchema = z.object({ amount: z.number().int('Whole paise').refine((v) => v !== 0, 'Not ₹0'), reason });

router.get('/current', async (req, res) => {
  res.json(await currentCashDay(req.ctx));
});
router.post('/', requireIdempotencyKey, validate({ body: openSchema }), async (req, res) => {
  res.status(201).json({ session: await openCashDay(req.ctx, req.valid.body, req.idempotencyKey) });
});
router.post('/:id/movements', requireIdempotencyKey, validate({ body: pettySchema }), async (req, res) => {
  res.status(201).json({ session: await addPettyCash(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
});
router.post('/:id/close', requireIdempotencyKey, validate({ body: closeSchema }), async (req, res) => {
  res.json({ session: await closeCashDay(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
});
router.post('/:id/adjustments', requireIdempotencyKey, validate({ body: adjustSchema }), async (req, res) => {
  res.status(201).json({ session: await adjustCashDay(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
});

export default router;
