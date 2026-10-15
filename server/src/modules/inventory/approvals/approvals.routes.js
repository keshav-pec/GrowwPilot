import { Router } from 'express';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { decideSchema, dismissSchema, reportSchema } from './approvals.schemas.js';
import * as service from './approvals.service.js';
import { decideWriteOff } from '../movements/movements.service.js';

// /api/inventory/requests — write-offs waiting for approval, and problems reported by the front desk
const router = Router();
const once = requireIdempotencyKey;

router.get('/', async (req, res) => {
  res.json({ requests: await service.listRequests(req.ctx) });
});
router.post('/reports', once, validate({ body: reportSchema }), async (req, res) => {
  res.status(201).json(await service.reportProblem(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/:id/decide', once, validate({ body: decideSchema }), async (req, res) => {
  res.json(await decideWriteOff(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/:id/dismiss', once, validate({ body: dismissSchema }), async (req, res) => {
  res.json(await service.dismissReport(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
