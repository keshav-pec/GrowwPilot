import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { primaryOwnerOnly, requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createServiceSchema, serviceStatusSchema, updateServiceSchema } from './services.schemas.js';
import * as controller from './services.controller.js';

const router = Router();
router.use(requireAuth, tenantContext);

// Everyone in the salon can read this; only the primary owner can change it

router.get('/', requireRole('OWNER', 'FRONT_DESK'), controller.list);
router.post('/', primaryOwnerOnly, validate({ body: createServiceSchema }), controller.create);
router.patch('/:id', primaryOwnerOnly, validate({ body: updateServiceSchema }), controller.update);
router.patch('/:id/status', primaryOwnerOnly, validate({ body: serviceStatusSchema }), controller.setStatus);

export default router;
