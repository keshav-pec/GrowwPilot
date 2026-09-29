import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import {
  convertLeadSchema,
  createLeadSchema,
  leadNoteSchema,
  leadStatusSchema,
  listLeadsSchema,
  updateLeadSchema,
} from './leads.schemas.js';
import * as controller from './leads.controller.js';

const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.get('/', validate({ query: listLeadsSchema }), controller.list);
router.get('/assignees', controller.assignees); // must come before '/:id'
router.post('/', validate({ body: createLeadSchema }), controller.create);
router.get('/:id', controller.getOne);
router.patch('/:id', validate({ body: updateLeadSchema }), controller.update);
router.patch('/:id/status', validate({ body: leadStatusSchema }), controller.setStatus);
router.post('/:id/notes', validate({ body: leadNoteSchema }), controller.addNote);
router.post('/:id/convert', validate({ body: convertLeadSchema }), controller.convert);

export default router;
