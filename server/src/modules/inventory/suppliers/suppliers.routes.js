import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { email, optionalPhone } from '../../../utils/schemas.js';
import * as service from './suppliers.service.js';

// /api/inventory/suppliers
const router = Router();

const text = (max) => z.string().trim().max(max).optional();
const fields = {
  name: z.string().trim().min(2, 'Name is required').max(100),
  contactName: text(100),
  phone: optionalPhone,
  email: email.optional().or(z.literal('').transform(() => undefined)),
  paymentTerms: text(100),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
  notes: text(500),
};
const createSchema = z.object(fields);
const updateSchema = z.object({ ...Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, v.optional()])), active: z.boolean().optional() });

router.get('/', validate({ query: z.object({ includeInactive: z.enum(['true', 'false']).optional() }) }), async (req, res) => {
  res.json({ suppliers: await service.listSuppliers(req.ctx, { includeInactive: req.valid.query.includeInactive === 'true' }) });
});
router.post('/', requireIdempotencyKey, validate({ body: createSchema }), async (req, res) => {
  res.status(201).json(await service.createSupplier(req.ctx, req.valid.body, req.idempotencyKey));
});
router.patch('/:id', requireIdempotencyKey, validate({ body: updateSchema }), async (req, res) => {
  res.json(await service.updateSupplier(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
