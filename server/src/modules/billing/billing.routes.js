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
import { REPORTS, duesOverview, runReport } from './reports.service.js';
import { toCsv } from '../../utils/csv.js';

// /api/billing — billing settings (owners), reports (owners; the front desk only today's collections) and dues
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));
const ownersOnly = requireRole('OWNER');

const settingsSchema = z.object({
  legalName: z.string().trim().max(120).optional(),
  gstRegistered: z.boolean().optional(),
  pricesIncludeTax: z.boolean().optional(),
  defaultServiceTaxBps: z.number().int().refine((v) => GST_RATES_BPS.includes(v), 'Choose a GST rate from the list').optional(),
  defaultSacCode: z.string().trim().regex(/^(\d{4,8})?$/, 'SAC code is 4 to 8 digits').optional(),
  frontDeskDiscountLimitBps: z.number().int().min(0).max(10000).optional(),
  guestProductSales: z.boolean().optional(),
  defaultProductTaxBps: z.number().int().refine((v) => GST_RATES_BPS.includes(v), 'Choose a GST rate from the list').optional(),
  branchOwners: z.object({ approveRefunds: z.boolean(), voidBills: z.boolean(), editSettings: z.boolean() }).partial().optional(),
  frontDesk: z.object({ closeCash: z.boolean() }).partial().optional(),
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

router.get('/settings', ownersOnly, async (req, res) => {
  res.json(await getSettingsForScreen(req.ctx));
});
router.patch('/settings', ownersOnly, requireIdempotencyKey, validate({ body: settingsSchema }), async (req, res) => {
  await updateSettings(req.ctx, req.valid.body, req.idempotencyKey);
  res.json(await getSettingsForScreen(req.ctx));
});

export default router;

// GET /api/billing/reports — the list; /api/billing/reports/sales?from=2026-10-01&to=2026-10-31&branches=current|all&format=csv
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const reportQuery = z.object({ from: date.optional(), to: date.optional(), branches: z.enum(['current', 'all']).default('current'), format: z.enum(['json', 'csv']).default('json') });

router.get('/reports', (req, res) => {
  res.json({ reports: Object.entries(REPORTS).map(([name, r]) => ({ name, label: r.label })) });
});
router.get('/reports/:name', validate({ query: reportQuery }), async (req, res) => {
  const report = await runReport(req.ctx, req.params.name, req.valid.query);
  if (req.valid.query.format === 'csv') {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${report.name}-${report.from}-to-${report.to}.csv"`);
    return res.send(`\uFEFF${toCsv(report)}`);
  }
  res.json(report);
});

// The Dues page: bills with money owed, with their age, per age group and per customer
router.get('/dues', validate({ query: z.object({ branches: z.enum(['current', 'all']).default('current'), search: z.string().trim().max(100).optional() }) }), async (req, res) => {
  res.json(await duesOverview(req.ctx, req.valid.query));
});
