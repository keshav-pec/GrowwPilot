import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { availabilitySchema } from './appointments.schemas.js';
import * as controller from './appointments.controller.js';

const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

// Free start times for one stylist at the selected branch
router.get('/', validate({ query: availabilitySchema }), controller.availability);

export default router;
