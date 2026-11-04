import { crudController } from '../crud.controller.js';
import { createStaff, listStaff, setStaffStatus, updateStaff } from './staff.service.js';

export const { list, create, update } = crudController({ one: 'staff', many: 'staff' }, { list: listStaff, create: createStaff, update: updateStaff });

// The status change can also carry "the owner has seen the future bookings and still wants to go ahead"
export async function setStatus(req, res) {
  res.json({ staff: await setStaffStatus(req.ctx, req.params.id, req.valid.body) });
}
