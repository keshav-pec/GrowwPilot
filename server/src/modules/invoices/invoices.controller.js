import * as invoicesService from './invoices.service.js';

export async function create(req, res) {
  res.status(201).json({ invoice: await invoicesService.createInvoice(req.ctx, req.valid.body) });
}

export async function getOne(req, res) {
  res.json({ invoice: await invoicesService.getInvoice(req.ctx, req.params.id) });
}
