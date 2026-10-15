import { Router } from 'express';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { finishSchema, issueSchema, listHandoutsSchema, moveSchema, returnSchema } from './allocations.schemas.js';
import * as service from './allocations.service.js';

// /api/inventory/allocations — hand-outs (stock in use). Who may do what is checked in the service.
const router = Router();
const once = requireIdempotencyKey;

router.get('/', validate({ query: listHandoutsSchema }), async (req, res) => {
  res.json({ handouts: await service.listHandouts(req.ctx, req.valid.query) });
});
router.get('/recipients', async (req, res) => {
  res.json(await service.listRecipients(req.ctx));
});
router.post('/', once, validate({ body: issueSchema }), async (req, res) => {
  res.status(201).json(await service.issue(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/:id/finish', once, validate({ body: finishSchema }), async (req, res) => {
  res.json(await service.finish(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/:id/return', once, validate({ body: returnSchema }), async (req, res) => {
  res.json(await service.returnUnused(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/:id/move', once, validate({ body: moveSchema }), async (req, res) => {
  res.json(await service.move(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
