import * as payments from './payments.service.js';
import { findServiceStaff } from '../staff/staff.service.js';
import { payslipFileName, writePayslipPdf } from './payslip.pdf.js';

export async function recordPayment(req, res) {
  res.status(201).json({ payment: await payments.recordPayment(req.ctx, req.params.id, req.valid.body, req.get('Idempotency-Key')) });
}

export async function cancelPayment(req, res) {
  res.json({ payment: await payments.cancelPayment(req.ctx, req.params.id, req.valid.body) });
}

export async function payslip(req, res) {
  const data = await payments.getPayslip(req.ctx, req.params.id);
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${payslipFileName(data.item.staffName, data.item.month)}"`);
  writePayslipPdf(res, data);
}

export async function listAdvances(req, res) {
  const staff = await findServiceStaff(req.ctx, req.params.staffId);
  res.json({ advances: await payments.listAdvances(req.ctx, staff) });
}

export async function giveAdvance(req, res) {
  res.status(201).json({ advance: await payments.giveAdvance(req.ctx, req.params.staffId, req.valid.body, req.get('Idempotency-Key')) });
}

export async function closeAdvance(req, res) {
  await payments.closeAdvance(req.ctx, req.params.id, req.valid.body);
  res.json({ ok: true });
}
