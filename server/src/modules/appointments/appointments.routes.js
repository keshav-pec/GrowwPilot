import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { validate } from '../../middleware/validate.js';
import {
  appointmentStatusSchema,
  createAppointmentSchema,
  listAppointmentsSchema,
  updateAppointmentSchema,
} from './appointments.schemas.js';
import * as controller from './appointments.controller.js';

const router = Router();
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK'));

router.get('/', validate({ query: listAppointmentsSchema }), controller.list);
router.post('/', validate({ body: createAppointmentSchema }), controller.create);
router.get('/:id', controller.getOne);
router.patch('/:id', validate({ body: updateAppointmentSchema }), controller.update);
router.patch('/:id/status', validate({ body: appointmentStatusSchema }), controller.setStatus);

export default router;
