import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requirePrimaryOwner, requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { branchStatusSchema, createBranchSchema, updateBranchSchema } from './branches.schemas.js';
import * as controller from './branches.controller.js';

const router = Router();

// Every route below needs a logged-in user and a tenant context
router.use(requireAuth, tenantContext);

router.get('/', requireRole('OWNER', 'FRONT_DESK'), controller.list);
router.get('/:id', requireRole('OWNER'), controller.getOne);

// Creating, editing and archiving branches: primary owner only
router.post('/', requireRole('OWNER'), requirePrimaryOwner, validate({ body: createBranchSchema }), controller.create);
router.patch('/:id', requireRole('OWNER'), requirePrimaryOwner, validate({ body: updateBranchSchema }), controller.update);
router.patch('/:id/status', requireRole('OWNER'), requirePrimaryOwner, validate({ body: branchStatusSchema }), controller.setStatus);

export default router;
