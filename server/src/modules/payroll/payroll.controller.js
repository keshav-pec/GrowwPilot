import * as payrollService from './payroll.service.js';

export async function listStaffPay(req, res) {
  res.json(await payrollService.listStaffPay(req.ctx));
}

export async function getStaffPay(req, res) {
  res.json(await payrollService.getStaffPay(req.ctx, req.params.staffId));
}

export async function createPlan(req, res) {
  res.status(201).json({ plan: await payrollService.createPlan(req.ctx, req.params.staffId, req.valid.body) });
}

export async function updatePlan(req, res) {
  res.json({ plan: await payrollService.updatePlan(req.ctx, req.params.id, req.valid.body) });
}

export async function cancelPlan(req, res) {
  await payrollService.cancelPlan(req.ctx, req.params.id);
  res.json({ ok: true });
}

export async function endPlan(req, res) {
  res.json({ plan: await payrollService.endPlan(req.ctx, req.params.id, req.valid.body) });
}

export async function listRequests(req, res) {
  res.json({ requests: await payrollService.listRequests(req.ctx, req.valid.query) });
}

export async function createRequest(req, res) {
  res.status(201).json({ request: await payrollService.createRequest(req.ctx, req.valid.body) });
}

export async function approveRequest(req, res) {
  res.json({ plan: await payrollService.approveRequest(req.ctx, req.params.id, req.valid.body) });
}

export async function rejectRequest(req, res) {
  await payrollService.rejectRequest(req.ctx, req.params.id, req.valid.body);
  res.json({ ok: true });
}

export async function cancelRequest(req, res) {
  await payrollService.cancelRequest(req.ctx, req.params.id);
  res.json({ ok: true });
}
