import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import * as schemas from './gst.schemas.js';
import * as gst from './gst.service.js';
import { advancesView, checkNow, overview, salesRegister } from './gst.record.js';
import { sendCsv } from '../../utils/csv.js';
import multer from 'multer';
import { AppError } from '../../utils/AppError.js';
import { MAX_PROOF_BYTES, PROOF_TYPES } from './gst.proofs.js';
import * as gstr1 from './gstr1.service.js';
import { reviewCsv, writeReviewPdf } from './gstr1.review.js';
import * as purchases from './gst.purchases.js';
import * as worksheet from './gst.worksheet.js';

// /api/gst — GST setup. Owners only: branch owners can look, the business owner changes things (checked in the service).
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER'));
const once = requireIdempotencyKey;

router.get('/setup', async (req, res) => {
  res.json(await gst.getSetup(req.ctx));
});
router.get('/rules', async (req, res) => {
  res.json(await gst.ruleOptions(req.ctx));
});

// Each change answers with the whole screen again
const change = (work) => async (req, res) => {
  const result = await work(req);
  res.json({ result, setup: await gst.getSetup(req.ctx) });
};

router.patch('/setup', once, validate({ body: schemas.setupSchema }), change((req) => gst.saveSetup(req.ctx, req.valid.body, req.idempotencyKey)));
router.post('/registrations', once, validate({ body: schemas.registrationSchema }), change((req) => gst.addRegistration(req.ctx, req.valid.body, req.idempotencyKey)));
router.post('/registrations/:id/branches', once, validate({ body: schemas.linkSchema }), change((req) => gst.linkBranch(req.ctx, req.params.id, req.valid.body, req.idempotencyKey)));
router.post('/rules', once, validate({ body: schemas.createRuleSchema }), change((req) => gst.createRule(req.ctx, req.valid.body, req.idempotencyKey)));
router.patch('/rules/:id', once, validate({ body: schemas.updateRuleSchema }), change((req) => gst.updateRule(req.ctx, req.params.id, req.valid.body, req.idempotencyKey)));
router.delete('/rules/:id', once, change((req) => gst.deleteRule(req.ctx, req.params.id, req.idempotencyKey)));
router.post('/rules/:id/approve', once, validate({ body: schemas.approveRuleSchema }), change((req) => gst.approveRule(req.ctx, req.params.id, req.valid.body, req.idempotencyKey)));
router.post('/rule-groups/:groupId/link-unlinked', once, change((req) => gst.linkUnlinked(req.ctx, req.params.groupId, req.idempotencyKey)));
router.post('/test-bill', validate({ body: schemas.testBillSchema }), async (req, res) => {
  res.json(await gst.testBill(req.ctx, req.valid.body));
});
router.post('/activate', once, change((req) => gst.activate(req.ctx, req.idempotencyKey)));

// The tax record: the overview and the sales register (each checks who may see them)
router.get('/overview', validate({ query: schemas.overviewSchema }), async (req, res) => {
  res.json(await overview(req.ctx, req.valid.query));
});
router.get('/register', validate({ query: schemas.registerSchema }), async (req, res) => {
  const { format, ...filters } = req.valid.query;
  const register = await salesRegister(req.ctx, { ...filters, all: format === 'csv' });
  if (format === 'csv') return sendCsv(res, `sales-register-${register.month}.csv`, register);
  res.json(register);
});
router.get('/advances', validate({ query: schemas.advancesViewSchema }), async (req, res) => {
  const { format, ...filters } = req.valid.query;
  const view = await advancesView(req.ctx, filters);
  if (format === 'csv') return sendCsv(res, 'gst-advances.csv', view);
  res.json(view);
});
router.post('/check', once, async (req, res) => {
  res.json(await checkNow(req.ctx, req.idempotencyKey));
});

// ---- GSTR-1 ----
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_PROOF_BYTES, files: 1 },
  fileFilter: (req, file, done) => (PROOF_TYPES.includes(file.mimetype) ? done(null, true) : done(new AppError(400, 'UNSUPPORTED_PROOF', 'The proof must be a PDF, JPEG or PNG'))),
});
const receiveProof = (req, res, next) =>
  upload.single('proof')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'PROOF_TOO_LARGE', 'The proof can be at most 5 MB'));
    next(err);
  });
const sendFile = (res, { fileName, file }) => {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
  res.send(JSON.stringify(file));
};

router.get('/returns', validate({ query: schemas.listReturnsSchema }), async (req, res) => {
  res.json(await gstr1.listReturns(req.ctx, req.valid.query));
});
router.post('/returns', once, validate({ body: schemas.prepareReturnSchema }), async (req, res) => {
  res.status(201).json(await gstr1.prepareReturn(req.ctx, req.valid.body, req.idempotencyKey));
});
router.get('/returns/:id', async (req, res) => {
  res.json(await gstr1.getReturn(req.ctx, req.params.id));
});
router.get('/returns/:id/trail', validate({ query: schemas.trailSchema }), async (req, res) => {
  res.json(await gstr1.returnTrail(req.ctx, req.params.id, req.valid.query.row));
});
router.post('/returns/:id/approve', once, async (req, res) => {
  res.json(await gstr1.approveReturn(req.ctx, req.params.id, req.idempotencyKey));
});
router.post('/returns/:id/export', async (req, res) => {
  sendFile(res, await gstr1.exportReturn(req.ctx, req.params.id));
});
router.get('/returns/:id/review.csv', async (req, res) => {
  const found = await gstr1.reviewOf(req.ctx, req.params.id);
  sendCsv(res, `GSTR1-review-${found.gstin}-${found.period}-rev${found.revision}.csv`, reviewCsv(found));
});
router.get('/returns/:id/review.pdf', async (req, res) => {
  const found = await gstr1.reviewOf(req.ctx, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="GSTR1-review-${found.gstin}-${found.period}-rev${found.revision}.pdf"`);
  writeReviewPdf(res, found);
});
router.post('/returns/:id/reject', once, validate({ body: schemas.rejectSchema }), async (req, res) => {
  res.json(await gstr1.markRejected(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/returns/:id/file', once, receiveProof, validate({ body: schemas.filingSchema }), async (req, res) => {
  res.json(await gstr1.recordFiling(req.ctx, req.params.id, req.valid.body, req.file, req.idempotencyKey));
});
router.post('/returns/:id/adjustments', once, validate({ body: schemas.adjustmentSchema }), async (req, res) => {
  res.status(201).json(await gstr1.createAdjustment(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/adjustments/:id/export', async (req, res) => {
  sendFile(res, await gstr1.exportAdjustment(req.ctx, req.params.id));
});
router.post('/adjustments/:id/file', once, receiveProof, validate({ body: schemas.filingSchema }), async (req, res) => {
  res.json(await gstr1.recordAdjustmentFiled(req.ctx, req.params.id, req.valid.body, req.file, req.idempotencyKey));
});
router.get('/proofs/:id', async (req, res) => {
  const proof = await gstr1.filingProof(req.ctx, req.params.id);
  res.setHeader('Content-Type', proof.file.metadata.contentType);
  res.setHeader('Content-Disposition', `attachment; filename="${proof.file.filename.replace(/[^\w.-]/g, '_')}"`);
  proof.stream.pipe(res);
});
// ---- Purchases & ITC ----
const upload2b = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, done) => (/\.(json|csv)$/i.test(file.originalname) ? done(null, true) : done(new AppError(400, 'FILE_NOT_READABLE', 'Choose a .json or .csv file'))),
});
const receive2b = (req, res, next) =>
  upload2b.single('file')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') return next(new AppError(400, 'FILE_NOT_READABLE', 'The file can be at most 10 MB'));
    next(err);
  });
router.get('/purchases', validate({ query: schemas.purchasesQuerySchema }), async (req, res) => {
  res.json(await purchases.purchasesScreen(req.ctx, req.valid.query));
});
router.post('/purchases', once, validate({ body: schemas.addPurchaseSchema }), async (req, res) => {
  res.status(201).json(await purchases.addPurchase(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/purchases/import-2b', once, receive2b, validate({ body: schemas.import2bSchema }), async (req, res) => {
  res.json(await purchases.import2b(req.ctx, req.valid.body, req.file, req.idempotencyKey));
});
router.post('/purchases/not-claimed', once, validate({ body: schemas.decideMissingSchema }), async (req, res) => {
  res.status(201).json(await purchases.decideMissingRow(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/purchases/:id/cancel', once, validate({ body: schemas.cancelPurchaseSchema }), async (req, res) => {
  res.json(await purchases.cancelPurchase(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/purchases/:id/decision', once, validate({ body: schemas.decideSchema }), async (req, res) => {
  res.status(201).json(await purchases.decideItc(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});

// ---- GSTR-3B working sheet ----
router.post('/worksheets', once, validate({ body: schemas.worksheetSchema }), async (req, res) => {
  res.status(201).json(await worksheet.prepareWorksheet(req.ctx, req.valid.body, req.idempotencyKey));
});
router.get('/worksheets/:id', async (req, res) => {
  res.json(await worksheet.getWorksheet(req.ctx, req.params.id));
});
router.get('/worksheets/:id/trail', validate({ query: schemas.sheetTrailSchema }), async (req, res) => {
  res.json(await worksheet.worksheetTrail(req.ctx, req.params.id, req.valid.query.row));
});
router.put('/worksheets/:id/portal', once, validate({ body: schemas.portalSchema }), async (req, res) => {
  res.json(await worksheet.savePortalFigures(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/worksheets/:id/approve', once, validate({ body: schemas.approveSheetSchema }), async (req, res) => {
  res.json(await worksheet.approveWorksheet(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/worksheets/:id/file', once, receiveProof, validate({ body: schemas.filingSchema }), async (req, res) => {
  res.json(await worksheet.recordWorksheetFiling(req.ctx, req.params.id, req.valid.body, req.file, req.idempotencyKey));
});

router.patch('/units', once, validate({ body: schemas.unitsSchema }), change((req) => gstr1.saveUnitCodes(req.ctx, req.valid.body, req.idempotencyKey)));

export default router;
