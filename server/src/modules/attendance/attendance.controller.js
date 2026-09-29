import * as attendanceService from './attendance.service.js';

export async function list(req, res) {
  res.json(await attendanceService.listAttendance(req.ctx, req.valid.query));
}

export async function mark(req, res) {
  res.json(await attendanceService.markAttendance(req.ctx, req.valid.body));
}

export async function summary(req, res) {
  res.json(await attendanceService.monthlySummary(req.ctx, req.valid.query));
}
