import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requirePrimaryOwner, requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { comboStatusSchema, createComboSchema, updateComboSchema } from './combos.schemas.js';
import * as controller from './combos.controller.js';

const router = Router();
router.use(requireAuth, tenantContext);

const primaryOwner = [requireRole('OWNER'), requirePrimaryOwner];

router.get('/', requireRole('OWNER', 'FRONT_DESK'), controller.list);
router.post('/', ...primaryOwner, validate({ body: createComboSchema }), controller.create);
router.patch('/:id', ...primaryOwner, validate({ body: updateComboSchema }), controller.update);
router.patch('/:id/status', ...primaryOwner, validate({ body: comboStatusSchema }), controller.setStatus);

export default router;
