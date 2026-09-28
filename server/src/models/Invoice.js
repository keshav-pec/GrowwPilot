import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { PAYMENT_METHODS } from '../config/constants.js';

// A snapshot of each line at checkout time
const lineSchema = new mongoose.Schema(
  {
    serviceName: { type: String, required: true },
    staffName: String,
    price: money({ required: true }),
  },
  { _id: false }
);

// One part of a split payment, e.g. { method: 'UPI', amount: 50000 }
const paymentSchema = new mongoose.Schema(
  {
    method: { type: String, enum: PAYMENT_METHODS, required: true },
    amount: money({ required: true, min: 1 }), // every payment must be more than 0
    reference: { type: String, trim: true }, // e.g. UPI transaction id
  },
  { _id: false }
);

const invoiceSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    appointmentId: ref('Appointment', { required: true }),
    customerId: ref('Customer', { required: true }),
    invoiceNumber: { type: String, required: true }, // e.g. GP-AND-000123
    lines: [lineSchema],
    subtotal: money({ required: true }),
    discount: money({ default: 0 }),
    total: money({ required: true }),
    payments: [paymentSchema],
    paidAt: { type: Date, default: Date.now },
    createdBy: ref('User'),
  },
  { timestamps: true }
);

// The same appointment can never be paid twice
invoiceSchema.index({ appointmentId: 1 }, { unique: true });
invoiceSchema.index({ orgId: 1, invoiceNumber: 1 }, { unique: true });
invoiceSchema.index({ orgId: 1, branchId: 1, paidAt: 1 }); // revenue reports

export default mongoose.model('Invoice', invoiceSchema);
