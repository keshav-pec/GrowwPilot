import * as monthly from './monthlyPayroll.service.js';

export async function listRuns(req, res) {
  res.json({ runs: await monthly.listRuns(req.ctx) });
}

export async function getRun(req, res) {
  res.json(await monthly.getRun(req.ctx, req.valid.params.month));
}

export async function calculateRun(req, res) {
  await monthly.calculateRun(req.ctx, req.valid.params.month);
  res.json(await monthly.getRun(req.ctx, req.valid.params.month));
}

export async function lockRun(req, res) {
  await monthly.lockRun(req.ctx, req.valid.params.month);
  res.json(await monthly.getRun(req.ctx, req.valid.params.month));
}

export async function addAdjustment(req, res) {
  res.status(201).json({ adjustment: await monthly.addAdjustment(req.ctx, req.valid.body) });
}

export async function removeAdjustment(req, res) {
  await monthly.removeAdjustment(req.ctx, req.params.id);
  res.json({ ok: true });
}
