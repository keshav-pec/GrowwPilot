import * as leadsService from './leads.service.js';

export async function list(req, res) {
  res.json({ leads: await leadsService.listLeads(req.ctx, req.valid.query) });
}

export async function assignees(req, res) {
  res.json({ users: await leadsService.listAssignees(req.ctx) });
}

export async function getOne(req, res) {
  res.json(await leadsService.getLead(req.ctx, req.params.id));
}

export async function create(req, res) {
  res.status(201).json({ lead: await leadsService.createLead(req.ctx, req.valid.body) });
}

export async function update(req, res) {
  res.json({ lead: await leadsService.updateLead(req.ctx, req.params.id, req.valid.body) });
}

export async function setStatus(req, res) {
  res.json({ lead: await leadsService.setLeadStatus(req.ctx, req.params.id, req.valid.body.status) });
}

export async function addNote(req, res) {
  res.json({ lead: await leadsService.addNote(req.ctx, req.params.id, req.valid.body.text) });
}

export async function convert(req, res) {
  res.status(201).json(await leadsService.convertLead(req.ctx, req.params.id, req.valid.body));
}
