import { Router } from 'express';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { createSkuSchema, listSkusSchema, pageSchema, skuStatusSchema, updateSkuSchema } from './skus.schemas.js';
import * as controller from './skus.controller.js';

// /api/inventory/skus — products. Who may change what is checked in the service (permissions.js).
const router = Router();
const once = requireIdempotencyKey;

router.get('/', validate({ query: listSkusSchema }), controller.list);
router.post('/', once, validate({ body: createSkuSchema }), controller.create);
router.get('/:id', controller.getOne);
router.get('/:id/movements', validate({ query: pageSchema }), controller.movements);
router.patch('/:id', once, validate({ body: updateSkuSchema }), controller.update);
router.patch('/:id/status', once, validate({ body: skuStatusSchema }), controller.setStatus);
router.post('/:id/use-here', once, controller.useHere);

export default router;
