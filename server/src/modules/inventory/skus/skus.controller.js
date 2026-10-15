import * as service from './skus.service.js';

export async function list(req, res) {
  res.json(await service.listSkus(req.ctx, req.valid.query));
}

export async function getOne(req, res) {
  res.json(await service.getSku(req.ctx, req.params.id));
}

export async function movements(req, res) {
  res.json(await service.listSkuMovements(req.ctx, req.params.id, req.valid.query));
}

export async function create(req, res) {
  res.status(201).json(await service.createSku(req.ctx, req.valid.body, req.idempotencyKey));
}

export async function update(req, res) {
  res.json(await service.updateSku(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
}

export async function setStatus(req, res) {
  res.json(await service.setSkuStatus(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
}

export async function useHere(req, res) {
  res.json(await service.useSkuHere(req.ctx, req.params.id, req.idempotencyKey));
}
