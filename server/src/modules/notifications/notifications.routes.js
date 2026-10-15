import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { objectId } from '../../utils/schemas.js';
import { listNotifications, markRead } from './notifications.service.js';

const router = Router();

// Everyone in a salon has a bell; each user only ever sees their own messages
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK', 'INVENTORY'));

router.get('/', async (req, res) => {
  res.json(await listNotifications(req.ctx));
});

// { ids?: [...] } — no ids = mark everything read
router.post('/read', validate({ body: z.object({ ids: z.array(objectId).max(100).optional() }) }), async (req, res) => {
  res.json(await markRead(req.ctx, req.valid.body.ids));
});

export default router;
