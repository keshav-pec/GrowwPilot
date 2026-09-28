import * as servicesService from './services.service.js';

export async function list(req, res) {
  res.json({ services: await servicesService.listServices(req.ctx) });
}

export async function create(req, res) {
  res.status(201).json({ service: await servicesService.createService(req.ctx, req.valid.body) });
}

export async function update(req, res) {
  res.json({ service: await servicesService.updateService(req.ctx, req.params.id, req.valid.body) });
}

export async function setStatus(req, res) {
  res.json({ service: await servicesService.setServiceStatus(req.ctx, req.params.id, req.valid.body.status) });
}
