import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { listActivity } from './activity.service.js';

const router = Router();

// Owners only. Which branches each owner sees is decided in the service.
router.use(requireAuth, tenantContext, requireRole('OWNER'));

// GET /api/activity?page=2&area=payroll
const querySchema = z.object({ page: z.coerce.number().int().min(1).default(1), area: z.enum(['payroll', 'inventory']).optional() });
router.get('/', validate({ query: querySchema }), async (req, res) => {
  res.json(await listActivity(req.ctx, req.valid.query));
});

export default router;
