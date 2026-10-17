import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { runReport, toCsv } from './reports.service.js';

// /api/inventory/reports/:name?from=2026-10-01&to=2026-10-31&branches=current|all&format=csv
const router = Router();

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const querySchema = z.object({
  from: date.optional(),
  to: date.optional(),
  branches: z.enum(['current', 'all']).default('current'),
  format: z.enum(['json', 'csv']).default('json'),
});

router.get('/:name', validate({ query: querySchema }), async (req, res) => {
  const report = await runReport(req.ctx, req.params.name, req.valid.query);
  if (req.valid.query.format === 'csv') {
    // Built on the server, so cost columns are already gone for people who may not see costs (AC27)
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${report.name}-${report.from}-to-${report.to}.csv"`);
    return res.send(`﻿${toCsv(report)}`);
  }
  res.json(report);
});

export default router;
