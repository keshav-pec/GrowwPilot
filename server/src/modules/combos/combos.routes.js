import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { primaryOwnerOnly, requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { comboStatusSchema, createComboSchema, updateComboSchema } from './combos.schemas.js';
import * as controller from './combos.controller.js';

const router = Router();
router.use(requireAuth, tenantContext);

// Everyone in the salon can read this; only the primary owner can change it

router.get('/', requireRole('OWNER', 'FRONT_DESK'), controller.list);
router.post('/', primaryOwnerOnly, validate({ body: createComboSchema }), controller.create);
router.patch('/:id', primaryOwnerOnly, validate({ body: updateComboSchema }), controller.update);
router.patch('/:id/status', primaryOwnerOnly, validate({ body: comboStatusSchema }), controller.setStatus);

export default router;
