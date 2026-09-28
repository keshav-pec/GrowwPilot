import * as staffService from './staff.service.js';

export async function list(req, res) {
  res.json({ staff: await staffService.listStaff(req.ctx) });
}

export async function create(req, res) {
  res.status(201).json({ staff: await staffService.createStaff(req.ctx, req.valid.body) });
}

export async function update(req, res) {
  res.json({ staff: await staffService.updateStaff(req.ctx, req.params.id, req.valid.body) });
}

export async function setStatus(req, res) {
  res.json({ staff: await staffService.setStaffStatus(req.ctx, req.params.id, req.valid.body) });
}
