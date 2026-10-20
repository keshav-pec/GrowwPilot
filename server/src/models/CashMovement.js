import mongoose from 'mongoose';
import { appendOnly, ref } from './fields.js';

// Cash that moved without a bill, on one cash day, never changed afterwards:
//   PETTY_IN / PETTY_OUT  while the day is open (e.g. ₹200 out for milk and tea), always with a reason
//   ADJUSTMENT            an owner's correction to a closed day (plus or minus), with a reason
const cashMovementSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    sessionId: ref('CashSession', { required: true }),
    kind: { type: String, enum: ['PETTY_IN', 'PETTY_OUT', 'ADJUSTMENT'], required: true },
    amount: { type: Number, required: true, validate: { validator: (v) => Number.isInteger(v) && v !== 0, message: 'Amount must be whole paise, not 0' } }, // ADJUSTMENT may be minus
    reason: { type: String, required: true, trim: true },
    byId: ref('User', { required: true }),
    byName: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false }, collection: 'cash_movements' }
);

cashMovementSchema.index({ sessionId: 1, createdAt: 1 });
appendOnly(cashMovementSchema, 'A cash movement');

export default mongoose.model('CashMovement', cashMovementSchema);
