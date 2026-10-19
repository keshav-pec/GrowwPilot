import mongoose from 'mongoose';
import { appendOnly, ref, money } from './fields.js';

// One line of commission: one service on one paid bill, for the stylist who did it.
// It keeps the rate and where it came from, so later rate changes never change past earnings.
// Rows are never edited. A refund, or a payment that turns out to be wrong, adds a 'reversal' row with minus amounts.
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
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // branch-local day the bill became fully paid
    // what the customer paid for this service, after discounts and without GST (minus on a reversal)
    saleAmount: { type: Number, required: true, validate: { validator: Number.isInteger, message: 'Sale amount must be whole paise' } },
    rateBps: { type: Number, required: true, min: 0, max: 10000 },
    rateSource: { type: String, enum: ['service_rate', 'pay_setup'], required: true },
    ruleId: { type: mongoose.Schema.Types.ObjectId, required: true }, // the CommissionRule or PayPlan used
    amount: { type: Number, required: true, validate: { validator: Number.isInteger, message: 'Commission must be whole paise' } },
    type: { type: String, enum: ['earned', 'reversal'], default: 'earned' },
    // Why this row exists: "paid:1" (earned the first time), "refund:<id>", "payment_reversed:<id>", "void:<bill id>"
    eventKey: { type: String },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

// The same event can only write one row per service (safe against retries)
commissionEntrySchema.index({ invoiceId: 1, itemId: 1, type: 1, eventKey: 1 }, { name: 'one_row_per_event', unique: true });
commissionEntrySchema.index({ orgId: 1, staffId: 1, day: 1 });

appendOnly(commissionEntrySchema, 'Commission entries');

export default mongoose.model('CommissionEntry', commissionEntrySchema, 'commission_entries');
