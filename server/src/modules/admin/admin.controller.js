import * as adminService from './admin.service.js';

export async function listOrgs(req, res) {
  res.json({ orgs: await adminService.listOrgs(req.valid.query) });
}

export async function getOrg(req, res) {
  res.json({ org: await adminService.getOrg(req.params.id) });
}

export async function createOrg(req, res) {
  res.status(201).json(await adminService.createOrg(req.valid.body));
}

export async function setOrgStatus(req, res) {
  res.json({ org: await adminService.setOrgStatus(req.params.id, req.valid.body.status) });
}
