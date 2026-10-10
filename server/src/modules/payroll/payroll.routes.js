import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { decisionSchema, endPlanSchema, listRequestsSchema, planSchema, requestSchema } from './payroll.schemas.js';
import * as controller from './payroll.controller.js';

const router = Router();

// Owners and front desk. Branch access (branch owners, front desk) is checked in the service.
// The Super Admin never gets salary data.
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

// Pay setup: everyone in the salon can look (front desk: their branch, without history)
router.get('/staff', controller.listStaffPay);
router.get('/staff/:staffId', controller.getStaffPay);

// Owners change pay directly
router.post('/staff/:staffId/plans', requireRole('OWNER'), validate({ body: planSchema }), controller.createPlan);
router.patch('/plans/:id', requireRole('OWNER'), validate({ body: planSchema }), controller.updatePlan);
router.delete('/plans/:id', requireRole('OWNER'), controller.cancelPlan);
router.post('/plans/:id/end', requireRole('OWNER'), validate({ body: endPlanSchema }), controller.endPlan);

// The front desk asks, an owner answers
router.get('/requests', validate({ query: listRequestsSchema }), controller.listRequests);
router.post('/requests', requireRole('FRONT_DESK'), validate({ body: requestSchema }), controller.createRequest);
router.post('/requests/:id/approve', requireRole('OWNER'), validate({ body: decisionSchema }), controller.approveRequest);
router.post('/requests/:id/reject', requireRole('OWNER'), validate({ body: decisionSchema }), controller.rejectRequest);
router.post('/requests/:id/cancel', requireRole('FRONT_DESK'), controller.cancelRequest);

export default router;
