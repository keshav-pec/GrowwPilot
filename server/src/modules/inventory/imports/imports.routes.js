import express, { Router } from 'express';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { commitImportSchema, importParamsSchema, previewImportSchema } from './imports.schemas.js';
import * as service from './imports.service.js';

// /api/inventory/imports — spreadsheet (CSV) import. The browser reads the file and sends its rows.
const router = Router();

// Up to 2,000 rows is more than the app's usual 100 kb, so this route alone reads a bigger body
// (only after the login and add-on checks, see app.js and inventory.routes.js)
router.use(express.json({ limit: '2mb' }));

router.post('/preview', validate({ body: previewImportSchema }), async (req, res) => {
  res.status(201).json(await service.previewImport(req.ctx, req.valid.body));
});
router.get('/:id', validate({ params: importParamsSchema }), async (req, res) => {
  res.json(await service.getImport(req.ctx, req.valid.params.id));
});
router.post('/:id/commit', requireIdempotencyKey, validate({ params: importParamsSchema, body: commitImportSchema }), async (req, res) => {
  res.json(await service.commitImport(req.ctx, req.valid.params.id, req.valid.body, req.idempotencyKey));
});

export default router;
