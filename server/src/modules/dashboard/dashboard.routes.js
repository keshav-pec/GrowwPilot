import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as controller from './dashboard.controller.js';

const router = Router();

// Owners only: the front desk doesn't see revenue (plan, assumption 4)
router.get('/', requireAuth, tenantContext, requireRole('OWNER'), controller.get);

export default router;
