import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createStaffSchema, staffStatusSchema, updateStaffSchema } from './staff.schemas.js';
import * as controller from './staff.controller.js';

const router = Router();
router.use(requireAuth, tenantContext);

// The front desk can see the staff list (needed for booking), only owners can change it
router.get('/', requireRole('OWNER', 'FRONT_DESK'), controller.list);
router.post('/', requireRole('OWNER'), validate({ body: createStaffSchema }), controller.create);
router.patch('/:id', requireRole('OWNER'), validate({ body: updateStaffSchema }), controller.update);
router.patch('/:id/status', requireRole('OWNER'), validate({ body: staffStatusSchema }), controller.setStatus);

export default router;
