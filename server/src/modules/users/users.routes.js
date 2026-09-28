import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createUserSchema, updateUserSchema, userStatusSchema } from './users.schemas.js';
import * as controller from './users.controller.js';

const router = Router();

// Owners only. Which users each owner may manage is checked in the service.
router.use(requireAuth, tenantContext, requireRole('OWNER'));

router.get('/', controller.list);
router.post('/', validate({ body: createUserSchema }), controller.create);
router.patch('/:id', validate({ body: updateUserSchema }), controller.update);
router.post('/:id/reset-password', controller.resetPassword);
router.patch('/:id/status', validate({ body: userStatusSchema }), controller.setStatus);

export default router;
