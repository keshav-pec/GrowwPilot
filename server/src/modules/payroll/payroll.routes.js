import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import {
  adjustmentSchema,
  decisionSchema,
  endPlanSchema,
  listRequestsSchema,
  lockSchema,
  monthParamSchema,
  monthSchema,
  planSchema,
  requestSchema,
  serviceRateSchema,
} from './payroll.schemas.js';
import * as controller from './payroll.controller.js';
import * as monthly from './monthlyPayroll.controller.js';

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

// Commission: what someone earned (owners only), and special rates per service (owners change them)
router.get('/staff/:staffId/commission', requireRole('OWNER'), validate({ query: monthSchema }), controller.getCommission);
router.put('/staff/:staffId/service-rates/:serviceId', requireRole('OWNER'), validate({ body: serviceRateSchema }), controller.setServiceRate);
router.delete('/staff/:staffId/service-rates/:serviceId', requireRole('OWNER'), controller.removeServiceRate);

// The front desk asks, an owner answers
router.get('/requests', validate({ query: listRequestsSchema }), controller.listRequests);
router.post('/requests', requireRole('FRONT_DESK'), validate({ body: requestSchema }), controller.createRequest);
router.post('/requests/:id/approve', requireRole('OWNER'), validate({ body: decisionSchema }), controller.approveRequest);
router.post('/requests/:id/reject', requireRole('OWNER'), validate({ body: decisionSchema }), controller.rejectRequest);
router.post('/requests/:id/cancel', requireRole('FRONT_DESK'), controller.cancelRequest);

// Monthly payroll for the selected branch: owners only (branch owners: their branches)
const owner = requireRole('OWNER');
router.get('/runs', owner, monthly.listRuns);
router.get('/runs/:month', owner, validate({ params: monthParamSchema }), monthly.getRun);
router.post('/runs/:month/calculate', owner, validate({ params: monthParamSchema }), monthly.calculateRun);
router.post('/runs/:month/lock', owner, validate({ params: monthParamSchema, body: lockSchema }), monthly.lockRun);
router.post('/adjustments', owner, validate({ body: adjustmentSchema }), monthly.addAdjustment);
router.delete('/adjustments/:id', owner, monthly.removeAdjustment);

export default router;
