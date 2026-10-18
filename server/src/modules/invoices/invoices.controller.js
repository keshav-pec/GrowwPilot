import * as invoicesService from './invoices.service.js';

export async function list(req, res) {
  res.json(await invoicesService.listInvoices(req.ctx, req.valid.query));
}

// Opens (or makes) the draft bill for a finished appointment
export async function openDraft(req, res) {
  res.status(201).json({ invoice: await invoicesService.openDraft(req.ctx, req.valid.body) });
}

export async function getOne(req, res) {
  res.json({ invoice: await invoicesService.getInvoice(req.ctx, req.params.id) });
}

export async function quote(req, res) {
  res.json({ invoice: await invoicesService.quoteDraft(req.ctx, req.params.id, req.valid.body) });
}

export async function save(req, res) {
  res.json({ invoice: await invoicesService.saveDraft(req.ctx, req.params.id, req.valid.body) });
}

export async function issue(req, res) {
  res.json({ invoice: await invoicesService.issueInvoice(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
}

export async function requestApproval(req, res) {
  res.json({ invoice: await invoicesService.requestApproval(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
}

export async function approve(req, res) {
  res.json({ invoice: await invoicesService.approveDiscount(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
}

export async function reject(req, res) {
  res.json({ invoice: await invoicesService.rejectDiscount(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
}
