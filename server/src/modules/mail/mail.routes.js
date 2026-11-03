import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requirePrimaryOwner, requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { objectId } from '../../utils/schemas.js';
import { mailStatus, sendTestEmail, testEmailState } from './mail.service.js';

// /api/mail — the Email card in Settings. Business owner only.
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER'), requirePrimaryOwner);

router.get('/status', async (req, res) => {
  res.json(await mailStatus(req.ctx, req.user));
});

router.post('/test', requireIdempotencyKey, async (req, res) => {
  res.status(202).json(await sendTestEmail(req.ctx, { user: req.user, key: req.idempotencyKey }));
});

router.get('/test/:id', validate({ params: z.object({ id: objectId }) }), async (req, res) => {
  res.json(await testEmailState(req.ctx, req.valid.params.id));
});

export default router;
