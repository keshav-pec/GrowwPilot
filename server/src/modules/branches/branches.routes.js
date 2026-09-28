import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as controller from './branches.controller.js';

const router = Router();

// Every route below needs a logged-in user and a tenant context
router.use(requireAuth, tenantContext);

router.get('/', requireRole('OWNER', 'FRONT_DESK'), controller.list);
router.get('/:id', requireRole('OWNER'), controller.getOne); // branch details: owner only

export default router;
