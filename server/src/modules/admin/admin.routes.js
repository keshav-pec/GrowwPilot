import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createOrgSchema, listOrgsSchema, setStatusSchema } from './admin.schemas.js';
import * as controller from './admin.controller.js';

const router = Router();

// Super Admin only. (No tenantContext here: the Super Admin works across all salons.)
router.use(requireAuth, requireRole('SUPER_ADMIN'));

router.get('/orgs', validate({ query: listOrgsSchema }), controller.listOrgs);
router.post('/orgs', validate({ body: createOrgSchema }), controller.createOrg);
router.get('/orgs/:id', controller.getOrg);
router.patch('/orgs/:id/status', validate({ body: setStatusSchema }), controller.setOrgStatus);

export default router;
