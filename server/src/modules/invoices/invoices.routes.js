import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import * as schemas from './invoices.schemas.js';
import * as controller from './invoices.controller.js';
import { offersForInvoice, setInvoiceOffer } from '../occasions/checkout/checkout.service.js';
import { objectId } from '../../utils/schemas.js';
import { z } from 'zod';

// /api/invoices — bills (owners and front desk; branch access is checked in the service)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.get('/', validate({ query: schemas.listSchema }), controller.list);
router.post('/', validate({ body: schemas.openDraftSchema }), controller.openDraft); // safe to repeat: one bill per appointment
router.post('/sale', validate({ body: schemas.saleSchema }), controller.createSale);
router.get('/products', validate({ query: schemas.productSearchSchema }), controller.products); // what can be sold here
router.get('/:id', controller.getOne);
router.get('/:id/pdf', controller.pdf);
router.get('/:id/history', controller.history);
router.post('/:id/share', controller.share); // a link for the customer (see share.js)

// Drafts (stale edits are refused by version)
router.patch('/:id', validate({ body: schemas.saveDraftSchema }), controller.save);
router.delete('/:id', validate({ query: schemas.versionQuerySchema }), controller.discard);
// Birthday / anniversary offers on a draft: what can be applied, and apply one (or take it off)
router.get('/:id/occasion-offers', async (req, res) => {
  res.json(await offersForInvoice(req.ctx, req.params.id));
});
router.post('/:id/occasion-offer', validate({ body: z.object({ offerIssueId: objectId.nullable(), version: z.number().int().min(0) }) }), async (req, res) => {
  res.json(await setInvoiceOffer(req.ctx, req.params.id, req.valid.body));
});
router.post('/:id/quote', validate({ body: schemas.quoteSchema }), controller.quote); // preview only, saves nothing
router.post('/:id/products', validate({ body: schemas.addProductSchema }), controller.addProduct);
router.delete('/:id/lines/:lineId', validate({ query: schemas.versionQuerySchema }), controller.removeLine);

// Money changes: an Idempotency-Key makes a double click or retry harmless
router.post('/:id/issue', requireIdempotencyKey, validate({ body: schemas.issueSchema }), controller.issue);
router.post('/:id/void', requireIdempotencyKey, validate({ body: schemas.voidSchema }), controller.voidBill);
router.post('/:id/request-approval', requireIdempotencyKey, validate({ body: schemas.requestApprovalSchema }), controller.requestApproval);
router.post('/:id/approve', requireIdempotencyKey, validate({ body: schemas.approveSchema }), controller.approve);
router.post('/:id/reject', requireIdempotencyKey, validate({ body: schemas.rejectSchema }), controller.reject);

export default router;
