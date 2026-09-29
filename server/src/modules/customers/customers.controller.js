import * as customersService from './customers.service.js';

export async function list(req, res) {
  res.json(await customersService.listCustomers(req.ctx, req.valid.query));
}

export async function getOne(req, res) {
  res.json(await customersService.getCustomerProfile(req.ctx, req.params.id));
}

export async function create(req, res) {
  res.status(201).json({ customer: await customersService.createCustomer(req.ctx, req.valid.body) });
}

export async function update(req, res) {
  res.json({ customer: await customersService.updateCustomer(req.ctx, req.params.id, req.valid.body) });
}
