import mongoose from 'mongoose';
import { appendOnly, ref, money } from './fields.js';

// One line of commission: one service on one paid bill, for the stylist who did it.
// It keeps the rate and where it came from, so later rate changes never change past earnings.
// Rows are never edited; a correction would be a new 'reversal' row (the app has no refunds yet).
const commissionEntrySchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    staffId: ref('Staff', { required: true }),
    invoiceId: ref('Invoice', { required: true }),
    invoiceNumber: { type: String, required: true },
    appointmentId: ref('Appointment', { required: true }),
    itemId: { type: mongoose.Schema.Types.ObjectId, required: true }, // the service line inside the appointment
    serviceId: ref('Service'),
    serviceName: { type: String, required: true },
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // branch-local day the bill was paid
    saleAmount: money({ required: true }), // this service's share of what the customer actually paid
    rateBps: { type: Number, required: true, min: 0, max: 10000 },
    rateSource: { type: String, enum: ['service_rate', 'pay_setup'], required: true },
    ruleId: { type: mongoose.Schema.Types.ObjectId, required: true }, // the CommissionRule or PayPlan used
    amount: { type: Number, required: true, validate: { validator: Number.isInteger, message: 'Commission must be whole paise' } },
    type: { type: String, enum: ['earned', 'reversal'], default: 'earned' },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The same service on the same bill can only earn commission once (safe against retries)
commissionEntrySchema.index({ invoiceId: 1, itemId: 1, type: 1 }, { unique: true });
commissionEntrySchema.index({ orgId: 1, staffId: 1, day: 1 });

appendOnly(commissionEntrySchema, 'Commission entries');

export default mongoose.model('CommissionEntry', commissionEntrySchema, 'commission_entries');
