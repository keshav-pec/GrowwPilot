import * as scheduling from './scheduling.service.js';

export async function availability(req, res) {
  res.json(await scheduling.getAvailability(req.ctx, req.valid.query));
}
