import { getDashboard } from './dashboard.service.js';

export async function get(req, res) {
  res.json(await getDashboard(req.ctx));
}
