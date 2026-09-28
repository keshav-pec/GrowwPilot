import * as branchesService from './branches.service.js';

export async function list(req, res) {
  res.json({ branches: await branchesService.listBranches(req.ctx) });
}

export async function getOne(req, res) {
  res.json({ branch: await branchesService.getBranch(req.ctx, req.params.id) });
}

export async function create(req, res) {
  res.status(201).json({ branch: await branchesService.createBranch(req.ctx, req.valid.body) });
}

export async function update(req, res) {
  res.json({ branch: await branchesService.updateBranch(req.ctx, req.params.id, req.valid.body) });
}

export async function setStatus(req, res) {
  res.json({ branch: await branchesService.setBranchStatus(req.ctx, req.params.id, req.valid.body.status) });
}
