import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { analyticsSchema } from './analytics.schemas.js';
import * as controller from './analytics.controller.js';

const router = Router();

// Owners only (the front desk doesn't see revenue analytics)
router.use(requireAuth, tenantContext, requireRole('OWNER'), validate({ query: analyticsSchema }));

router.get('/', controller.get);
router.get('/export.pdf', controller.exportPdf);

export default router;
