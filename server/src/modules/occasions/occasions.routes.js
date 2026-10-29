import express, { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import { objectId } from '../../utils/schemas.js';
import { toCsv } from '../../utils/csv.js';
import { z } from 'zod';
import {
  assignSchema,
  consentSchema,
  contactSchema,
  createCampaignSchema,
  datesSchema,
  ifMatchSchema,
  importSchema,
  messagesSchema,
  offersQuerySchema,
  reasonSchema,
  reportQuerySchema,
  revokeSchema,
  sendPreviewSchema,
  sendSchema,
  settingsSchema,
  updateCampaignSchema,
} from './occasions.schemas.js';
import { getSettingsForScreen, updateSettings } from './settings.service.js';
import { consentHistory, getConsents, recordConsent, removeOccasionData, setCustomerDates } from './customers.service.js';
import { importDates, importTemplate } from './import.service.js';
import * as campaigns from './campaigns/campaigns.service.js';
import { customerOffers, getOffer, listOffers, offerSummary } from './worklist/worklist.service.js';
import { revokeCampaignOffers, runAfterPublish, runNow } from './engine/actions.service.js';
import { assignOffer, listAssignees, recordContact, sendOffer, sendPreview } from './outreach/followup.service.js';
import { liveOffers } from './checkout/checkout.service.js';
import { occasionReport, occasionReportCsv } from './reports/report.service.js';

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
// "Check now": this month's offers again for every branch (nothing is ever given twice)
router.post('/settings/run-now', async (req, res) => {
  res.json(await runNow(req.ctx));
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

// Campaigns (owners; a branch owner only their branches' own campaigns). Writes need an Idempotency-Key;
// an edit also needs If-Match with the campaign version the screen loaded.
router.get('/campaigns', validate({ query: z.object({ includeArchived: z.enum(['true', 'false']).default('false') }) }), async (req, res) => {
  res.json(await campaigns.listCampaigns(req.ctx, { includeArchived: req.valid.query.includeArchived === 'true' }));
});
router.post('/campaigns', requireIdempotencyKey, validate({ body: createCampaignSchema }), async (req, res) => {
  res.status(201).json(await campaigns.createCampaign(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/campaigns/starters', requireIdempotencyKey, async (req, res) => {
  res.status(201).json(await campaigns.createStarterDrafts(req.ctx, req.idempotencyKey));
});
router.get('/campaigns/:id', idParams, async (req, res) => {
  res.json(await campaigns.getCampaign(req.ctx, req.params.id));
});
router.patch('/campaigns/:id', idParams, requireIdempotencyKey, validate({ headers: ifMatchSchema, body: updateCampaignSchema }), async (req, res) => {
  await campaigns.updateCampaign(req.ctx, req.params.id, req.valid.body, { version: req.valid.headers['if-match'], key: req.idempotencyKey });
  res.json(await campaigns.getCampaign(req.ctx, req.params.id));
});
// Publishing (or turning back on) gives this month's offers straight away
router.post('/campaigns/:id/publish', idParams, requireIdempotencyKey, async (req, res) => {
  await campaigns.publishCampaign(req.ctx, req.params.id, req.idempotencyKey);
  await runAfterPublish(req.ctx);
  res.json(await campaigns.getCampaign(req.ctx, req.params.id));
});
for (const change of ['disable', 'enable', 'archive']) {
  router.post(`/campaigns/:id/${change}`, idParams, requireIdempotencyKey, async (req, res) => {
    await campaigns.changeCampaignStatus(req.ctx, req.params.id, change, req.idempotencyKey);
    if (change === 'enable') await runAfterPublish(req.ctx);
    res.json(await campaigns.getCampaign(req.ctx, req.params.id));
  });
}
// Emergency withdraw (business owner): every unused offer of the campaign for a year
router.post('/campaigns/:id/revoke', idParams, requireIdempotencyKey, validate({ body: revokeSchema }), async (req, res) => {
  res.json(await revokeCampaignOffers(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/campaigns/:id/discard-draft', idParams, requireIdempotencyKey, async (req, res) => {
  await campaigns.discardDraft(req.ctx, req.params.id, req.idempotencyKey);
  res.json(await campaigns.getCampaign(req.ctx, req.params.id));
});
router.put('/campaigns/:id/messages', idParams, requireIdempotencyKey, validate({ headers: ifMatchSchema, body: messagesSchema }), async (req, res) => {
  await campaigns.updateMessages(req.ctx, req.params.id, req.valid.body, { version: req.valid.headers['if-match'], key: req.idempotencyKey });
  res.json(await campaigns.getCampaign(req.ctx, req.params.id));
});
router.get('/campaigns/:id/versions', idParams, async (req, res) => {
  res.json(await campaigns.listVersions(req.ctx, req.params.id));
});
router.get('/campaigns/:id/preview', idParams, async (req, res) => {
  res.json(await campaigns.previewCampaign(req.ctx, req.params.id));
});

// The occasion list: tiles, one page of offers, one offer for the drawer, and a customer's offers for their profile
router.get('/offers/summary', validate({ query: offersQuerySchema }), async (req, res) => {
  res.json(await offerSummary(req.ctx, req.valid.query));
});
router.get('/offers', validate({ query: offersQuerySchema }), async (req, res) => {
  res.json(await listOffers(req.ctx, req.valid.query));
});
router.get('/offers/:id', idParams, async (req, res) => {
  res.json(await getOffer(req.ctx, req.params.id));
});
// Follow-up: preview and send the message, record a call, assign
router.get('/offers/:id/send-preview', idParams, validate({ query: sendPreviewSchema }), async (req, res) => {
  res.json(await sendPreview(req.ctx, req.params.id, req.valid.query));
});
router.post('/offers/:id/send', idParams, requireIdempotencyKey, validate({ body: sendSchema }), async (req, res) => {
  res.json(await sendOffer(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/offers/:id/contact', idParams, requireIdempotencyKey, validate({ body: contactSchema }), async (req, res) => {
  res.json(await recordContact(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.get('/offers/:id/assignees', idParams, async (req, res) => {
  res.json(await listAssignees(req.ctx, req.params.id));
});
router.post('/offers/:id/assign', idParams, requireIdempotencyKey, validate({ body: assignSchema }), async (req, res) => {
  res.json(await assignOffer(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
// Offers a customer can still use, with the likely discount on the chosen services (booking box, check-in badge)
const liveQuery = z.object({ serviceIds: z.string().max(2000).optional().transform((v) => (v ? v.split(',').filter((id) => /^[a-f\d]{24}$/i.test(id)) : [])) });
router.get('/customers/:id/live-offers', idParams, validate({ query: liveQuery }), async (req, res) => {
  res.json(await liveOffers(req.ctx, req.params.id, req.valid.query));
});
router.get('/customers/:id/offers', idParams, async (req, res) => {
  res.json(await customerOffers(req.ctx, req.params.id));
});

// Reports → Occasion offers (owners). ?format=csv downloads one row per offer (logged).
router.get('/reports', validate({ query: reportQuerySchema }), async (req, res) => {
  if (req.valid.query.format === 'csv') {
    const report = await occasionReportCsv(req.ctx, req.valid.query);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${report.fileName}"`);
    return res.send(`\uFEFF${toCsv(report)}`);
  }
  res.json(await occasionReport(req.ctx, req.valid.query));
});

export default router;
