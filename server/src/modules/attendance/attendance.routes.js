import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { listAttendanceSchema, markAttendanceSchema, summarySchema } from './attendance.schemas.js';
import * as controller from './attendance.controller.js';

const router = Router();
router.use(requireAuth, tenantContext);

// The front desk runs the daily roster; only owners see the monthly summary
router.get('/', requireRole('OWNER', 'FRONT_DESK'), validate({ query: listAttendanceSchema }), controller.list);
router.put('/', requireRole('OWNER', 'FRONT_DESK'), validate({ body: markAttendanceSchema }), controller.mark);
router.get('/summary', requireRole('OWNER'), validate({ query: summarySchema }), controller.summary);

export default router;
