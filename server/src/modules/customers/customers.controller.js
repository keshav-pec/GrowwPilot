import * as customersService from './customers.service.js';

export async function search(req, res) {
  res.json({ customers: await customersService.searchCustomers(req.ctx, req.valid.query) });
}

export async function create(req, res) {
  res.status(201).json({ customer: await customersService.createCustomer(req.ctx, req.valid.body) });
}
