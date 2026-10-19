import * as invoicesService from './invoices.service.js';

export async function list(req, res) {
  res.json(await invoicesService.listInvoices(req.ctx, req.valid.query));
}

// Opens (or makes) the draft bill for a finished appointment
export async function openDraft(req, res) {
  res.status(201).json({ invoice: await invoicesService.openDraft(req.ctx, req.valid.body) });
}

// "New sale": an empty draft for products only
export async function createSale(req, res) {
  res.status(201).json({ invoice: await invoicesService.createSaleDraft(req.ctx, req.valid.body) });
}

export async function products(req, res) {
  res.json(await invoicesService.listSellableProducts(req.ctx, req.valid.query));
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

export async function discard(req, res) {
  res.json(await invoicesService.discardDraft(req.ctx, req.params.id, req.valid.query));
}

export async function addProduct(req, res) {
  res.json({ invoice: await invoicesService.addProduct(req.ctx, req.params.id, req.valid.body) });
}

export async function removeLine(req, res) {
  res.json({ invoice: await invoicesService.removeLine(req.ctx, req.params.id, req.params.lineId, req.valid.query) });
}

export async function issue(req, res) {
  res.json({ invoice: await invoicesService.issueInvoice(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
}

export async function voidBill(req, res) {
  res.json({ invoice: await invoicesService.voidInvoice(req.ctx, req.params.id, req.valid.body, req.idempotencyKey) });
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
