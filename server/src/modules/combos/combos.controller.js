import * as combosService from './combos.service.js';

export async function list(req, res) {
  res.json({ combos: await combosService.listCombos(req.ctx) });
}

export async function create(req, res) {
  res.status(201).json({ combo: await combosService.createCombo(req.ctx, req.valid.body) });
}

export async function update(req, res) {
  res.json({ combo: await combosService.updateCombo(req.ctx, req.params.id, req.valid.body) });
}

export async function setStatus(req, res) {
  res.json({ combo: await combosService.setComboStatus(req.ctx, req.params.id, req.valid.body.status) });
}
