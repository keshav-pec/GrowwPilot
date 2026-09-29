import * as scheduling from './scheduling.service.js';
import * as appointmentsService from './appointments.service.js';

export async function availability(req, res) {
  res.json(await scheduling.getAvailability(req.ctx, req.valid.query));
}

export async function list(req, res) {
  res.json({ appointments: await appointmentsService.listAppointments(req.ctx, req.valid.query) });
}

export async function getOne(req, res) {
  res.json({ appointment: await appointmentsService.getAppointment(req.ctx, req.params.id) });
}

export async function create(req, res) {
  res.status(201).json({ appointment: await appointmentsService.createAppointment(req.ctx, req.valid.body) });
}

export async function update(req, res) {
  res.json({ appointment: await appointmentsService.updateAppointment(req.ctx, req.params.id, req.valid.body) });
}

export async function setStatus(req, res) {
  res.json({ appointment: await appointmentsService.setAppointmentStatus(req.ctx, req.params.id, req.valid.body) });
}
