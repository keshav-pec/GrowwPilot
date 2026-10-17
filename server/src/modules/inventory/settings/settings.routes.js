import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { paise } from '../../../utils/schemas.js';
import { checkStockRecords, getSettingsForScreen, updateSettings } from './settings.service.js';

// /api/inventory/settings — the selected branch's inventory rules (owners)
const router = Router();

const updateSchema = z.object({
  frontDesk: z.object({ finish: z.boolean(), issue: z.boolean(), transfer: z.boolean(), receive: z.boolean() }).partial().optional(),
  limits: z.object({ inventoryWriteOff: paise, branchOwnerWriteOff: paise, branchOwnerPoApproval: paise }).partial().optional(),
  branchOwnerSeesCosts: z.boolean().optional(),
});

router.get('/', async (req, res) => {
  res.json(await getSettingsForScreen(req.ctx));
});
router.patch('/', requireIdempotencyKey, validate({ body: updateSchema }), async (req, res) => {
  res.json(await updateSettings(req.ctx, req.valid.body, req.idempotencyKey));
});
// Rebuild balances from the movement history and report any mismatch
router.get('/check', async (req, res) => {
  res.json(await checkStockRecords(req.ctx));
});

export default router;
