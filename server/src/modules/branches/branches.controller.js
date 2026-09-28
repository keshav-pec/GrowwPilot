import * as branchesService from './branches.service.js';

export async function list(req, res) {
  res.json({ branches: await branchesService.listBranches(req.ctx) });
}

export async function getOne(req, res) {
  res.json({ branch: await branchesService.getBranch(req.ctx, req.params.id) });
}
