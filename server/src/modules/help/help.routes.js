import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import * as helpService from './help.service.js';

const askSchema = z.object({
  message: z.string().trim().min(1, 'Type a question').max(500, 'Please keep it under 500 characters'),
});

const router = Router();

// The in-app assistant is for salon staff who log in (owners, front desk and inventory logins)
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK', 'INVENTORY'));

router.get('/start', async (req, res) => {
  res.json(await helpService.start(req.ctx, req.user));
});

router.post('/ask', validate({ body: askSchema }), async (req, res) => {
  res.json(await helpService.ask(req.ctx, req.user, req.valid.body.message));
});

export default router;
