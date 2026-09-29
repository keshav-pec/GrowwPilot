import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createCustomerSchema, searchCustomersSchema } from './customers.schemas.js';
import * as controller from './customers.controller.js';

const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.get('/', validate({ query: searchCustomersSchema }), controller.search);
router.post('/', validate({ body: createCustomerSchema }), controller.create);

export default router;
