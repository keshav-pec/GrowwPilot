import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { objectId } from '../../utils/schemas.js';
import { GST_RATES_BPS, PREFIX_REGEX } from '../../config/billing.js';
import { getSettingsForScreen, updateSettings } from './settings.service.js';

// /api/billing — billing settings (owners see them; only the business owner changes them)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER'));

const settingsSchema = z.object({
  legalName: z.string().trim().max(120).optional(),
  gstRegistered: z.boolean().optional(),
  pricesIncludeTax: z.boolean().optional(),
  defaultServiceTaxBps: z.number().int().refine((v) => GST_RATES_BPS.includes(v), 'Choose a GST rate from the list').optional(),
  defaultSacCode: z.string().trim().regex(/^(\d{4,8})?$/, 'SAC code is 4 to 8 digits').optional(),
  frontDeskDiscountLimitBps: z.number().int().min(0).max(10000).optional(),
  guestProductSales: z.boolean().optional(),
  branches: z
    .array(
      z.object({
        branchId: objectId,
        gstin: z.string().trim().toUpperCase().max(15).optional(),
        stateCode: z.string().regex(/^(\d{2})?$/, 'Choose a state').optional(),
        invoicePrefix: z.string().trim().toUpperCase().refine((v) => v === '' || PREFIX_REGEX.test(v), 'Prefix is 1 to 4 letters or digits').optional(),
      })
    )
    .max(100)
    .optional(),
});

router.get('/settings', async (req, res) => {
  res.json(await getSettingsForScreen(req.ctx));
});
router.patch('/settings', requireIdempotencyKey, validate({ body: settingsSchema }), async (req, res) => {
  await updateSettings(req.ctx, req.valid.body, req.idempotencyKey);
  res.json(await getSettingsForScreen(req.ctx));
});

export default router;
