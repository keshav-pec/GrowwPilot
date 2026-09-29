import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createCustomerSchema, listCustomersSchema, updateCustomerSchema } from './customers.schemas.js';
import * as controller from './customers.controller.js';

const router = Router();

// Customers belong to the salon (shared by all its branches), so owners and front desk can use them
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.get('/', validate({ query: listCustomersSchema }), controller.list);
router.post('/', validate({ body: createCustomerSchema }), controller.create);
router.get('/:id', controller.getOne);
router.patch('/:id', validate({ body: updateCustomerSchema }), controller.update);

export default router;
