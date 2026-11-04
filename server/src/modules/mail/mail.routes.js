import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requirePrimaryOwner, requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { objectId } from '../../utils/schemas.js';
import { EMAIL_KINDS, EMAIL_STATUSES } from '../../models/EmailOutbox.js';
import { mailLog, mailStatus, sendTestEmail, testEmailState } from './mail.service.js';

// /api/mail — the Email page. Status and test email: business owner. Recent emails: owners (their branches).
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER'));

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const logQuery = z.object({
  kind: z.enum(EMAIL_KINDS).optional(),
  status: z.enum(['WAITING', ...EMAIL_STATUSES]).optional(), // WAITING = PENDING or SENDING
  from: date.optional(),
  to: date.optional(),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});
router.get('/log', validate({ query: logQuery }), async (req, res) => {
  res.json(await mailLog(req.ctx, req.valid.query));
});

router.use(requirePrimaryOwner);

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
