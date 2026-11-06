import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import * as schemas from './gst.schemas.js';
import * as gst from './gst.service.js';

// /api/gst — GST setup. Owners only: branch owners can look, the business owner changes things (checked in the service).
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER'));
const once = requireIdempotencyKey;

router.get('/setup', async (req, res) => {
  res.json(await gst.getSetup(req.ctx));
});
router.get('/rules', async (req, res) => {
  res.json(await gst.ruleOptions(req.ctx));
});

// Each change answers with the whole screen again
const change = (work) => async (req, res) => {
  const result = await work(req);
  res.json({ result, setup: await gst.getSetup(req.ctx) });
};

router.patch('/setup', once, validate({ body: schemas.setupSchema }), change((req) => gst.saveSetup(req.ctx, req.valid.body, req.idempotencyKey)));
router.post('/registrations', once, validate({ body: schemas.registrationSchema }), change((req) => gst.addRegistration(req.ctx, req.valid.body, req.idempotencyKey)));
router.post('/registrations/:id/branches', once, validate({ body: schemas.linkSchema }), change((req) => gst.linkBranch(req.ctx, req.params.id, req.valid.body, req.idempotencyKey)));
router.post('/rules', once, validate({ body: schemas.createRuleSchema }), change((req) => gst.createRule(req.ctx, req.valid.body, req.idempotencyKey)));
router.patch('/rules/:id', once, validate({ body: schemas.updateRuleSchema }), change((req) => gst.updateRule(req.ctx, req.params.id, req.valid.body, req.idempotencyKey)));
router.delete('/rules/:id', once, change((req) => gst.deleteRule(req.ctx, req.params.id, req.idempotencyKey)));
router.post('/rules/:id/approve', once, validate({ body: schemas.approveRuleSchema }), change((req) => gst.approveRule(req.ctx, req.params.id, req.valid.body, req.idempotencyKey)));
router.post('/rule-groups/:groupId/link-unlinked', once, change((req) => gst.linkUnlinked(req.ctx, req.params.groupId, req.idempotencyKey)));
router.post('/test-bill', validate({ body: schemas.testBillSchema }), async (req, res) => {
  res.json(await gst.testBill(req.ctx, req.valid.body));
});
router.post('/activate', once, change((req) => gst.activate(req.ctx, req.idempotencyKey)));

export default router;
