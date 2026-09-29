import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { createInvoiceSchema } from './invoices.schemas.js';
import * as controller from './invoices.controller.js';

const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.post('/', validate({ body: createInvoiceSchema }), controller.create);
router.get('/:id', controller.getOne);

export default router;
