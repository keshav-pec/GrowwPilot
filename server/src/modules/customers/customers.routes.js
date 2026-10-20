import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createCustomerSchema, listCustomersSchema, updateCustomerSchema } from './customers.schemas.js';
import * as controller from './customers.controller.js';
import { customerMoney } from '../billing/reports.service.js';

const router = Router();

// Customers belong to the salon (shared by all its branches), so owners and front desk can use them
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.get('/', validate({ query: listCustomersSchema }), controller.list);
router.post('/', validate({ body: createCustomerSchema }), controller.create);
router.get('/:id', controller.getOne);
// Bills, payments, refunds, advance and what they owe (only bills at branches I may use)
router.get('/:id/money', async (req, res) => {
  res.json(await customerMoney(req.ctx, req.params.id));
});
router.patch('/:id', validate({ body: updateCustomerSchema }), controller.update);

export default router;
