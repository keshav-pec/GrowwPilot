import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import { requireIdempotencyKey } from '../../middleware/idempotency.js';
import * as schemas from './invoices.schemas.js';
import * as controller from './invoices.controller.js';

// /api/invoices — bills (owners and front desk; branch access is checked in the service)
const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.get('/', validate({ query: schemas.listSchema }), controller.list);
router.post('/', validate({ body: schemas.openDraftSchema }), controller.openDraft); // safe to repeat: one bill per appointment
router.get('/:id', controller.getOne);
router.patch('/:id', validate({ body: schemas.saveDraftSchema }), controller.save); // stale edits refused by version
router.post('/:id/quote', validate({ body: schemas.quoteSchema }), controller.quote); // preview only, saves nothing

// Money changes: an Idempotency-Key makes a double click or retry harmless
router.post('/:id/issue', requireIdempotencyKey, validate({ body: schemas.issueSchema }), controller.issue);
router.post('/:id/request-approval', requireIdempotencyKey, validate({ body: schemas.requestApprovalSchema }), controller.requestApproval);
router.post('/:id/approve', requireIdempotencyKey, validate({ body: schemas.approveSchema }), controller.approve);
router.post('/:id/reject', requireIdempotencyKey, validate({ body: schemas.rejectSchema }), controller.reject);

export default router;
