import express, { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { objectId } from '../../utils/schemas.js';
import { toCsv } from '../../utils/csv.js';
import { z } from 'zod';
import { consentSchema, datesSchema, ifMatchSchema, importSchema, reasonSchema, settingsSchema } from './occasions.schemas.js';
import { getSettingsForScreen, updateSettings } from './settings.service.js';
import { consentHistory, getConsents, recordConsent, removeOccasionData, setCustomerDates } from './customers.service.js';
import { importDates, importTemplate } from './import.service.js';

// /api/occasions — Birthday & Anniversary Offers. Owners and front desk; what each may do is checked in the
// services (permissions.js). The salon and the role always come from the login.
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

const idParams = validate({ params: z.object({ id: objectId }) });

// Settings: the switch, the data counts, the consent wording
router.get('/settings', async (req, res) => {
  res.json(await getSettingsForScreen(req.ctx));
});
router.put('/settings', requireIdempotencyKey, validate({ headers: ifMatchSchema, body: settingsSchema }), async (req, res) => {
  await updateSettings(req.ctx, req.valid.body, { version: req.valid.headers['if-match'], key: req.idempotencyKey });
  res.json(await getSettingsForScreen(req.ctx));
});

// One customer: dates and home branch, messaging permission and its history, remove occasion data
router.put('/customers/:id/dates', idParams, requireIdempotencyKey, validate({ body: datesSchema }), async (req, res) => {
  res.json(await setCustomerDates(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.get('/customers/:id/consents', idParams, async (req, res) => {
  res.json(await getConsents(req.ctx, req.params.id));
});
router.post('/customers/:id/consents', idParams, requireIdempotencyKey, validate({ body: consentSchema }), async (req, res) => {
  res.status(201).json(await recordConsent(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.get('/customers/:id/consents/history', idParams, async (req, res) => {
  res.json(await consentHistory(req.ctx, req.params.id));
});
router.post('/customers/:id/remove-data', idParams, requireIdempotencyKey, validate({ body: reasonSchema }), async (req, res) => {
  res.json(await removeOccasionData(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

// Spreadsheet import of dates. The template is a CSV; the upload is the file's rows as JSON (a bigger body,
// read only after the login check: see app.js). Saving needs an Idempotency-Key; checking doesn't.
router.get('/import/template', async (req, res) => {
  const report = await importTemplate(req.ctx);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="customer-occasions.csv"');
  res.send(`﻿${toCsv(report)}`);
});
router.post('/import', express.json({ limit: '2mb' }), validate({ body: importSchema }), async (req, res) => {
  res.json(await importDates(req.ctx, req.valid.body, req.get('Idempotency-Key')));
});

export default router;
