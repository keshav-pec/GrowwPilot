import { Router } from 'express';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { createLocationSchema, updateLocationSchema } from './locations.schemas.js';
import * as service from './locations.service.js';

// /api/inventory/locations — the selected branch's stores, In use and stations
const router = Router();

router.get('/', async (req, res) => {
  res.json({ locations: await service.listLocations(req.ctx) });
});
router.post('/', requireIdempotencyKey, validate({ body: createLocationSchema }), async (req, res) => {
  res.status(201).json(await service.createLocation(req.ctx, req.valid.body, req.idempotencyKey));
});
router.patch('/:id', requireIdempotencyKey, validate({ body: updateLocationSchema }), async (req, res) => {
  res.json(await service.updateLocation(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
