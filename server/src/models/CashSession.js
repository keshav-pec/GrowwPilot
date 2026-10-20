import mongoose from 'mongoose';
import { ref, money } from './fields.js';

// One cash day at a branch: opened with a float, closed by counting the drawer.
// While open, the expected cash is worked out live from cash payments, cash refunds and petty cash.
// When closed, the figures are saved here and never change; a mistake found later is fixed with an
// adjustment (CashMovement), so the closed record always shows what was counted.
const cashSessionSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    day: { type: String, required: true, match: /^\d{4}-\d{2}-\d{2}$/ }, // the branch-local day it covers
    status: { type: String, enum: ['OPEN', 'CLOSED'], default: 'OPEN' },
    openingFloat: money({ required: true }),
    openedBy: ref('User'),
    openedByName: String,
    openedAt: { type: Date, default: Date.now },

    // Saved when closed
    cashIn: money(), // cash payments received
    cashOut: money(), // cash refunds given
    pettyIn: money(),
    pettyOut: money(),
    expectedCash: money(), // float + cash in - cash out + petty in - petty out
    countedCash: money(),
    difference: { type: Number }, // counted - expected (minus = short)
    closeNote: String,
    closedBy: ref('User'),
    closedByName: String,
    closedAt: Date,
    version: { type: Number, default: 0 },
  },
  { timestamps: true, collection: 'cash_sessions' }
);

cashSessionSchema.index({ orgId: 1, branchId: 1, day: 1 }, { unique: true });
// At most one open cash day per branch
cashSessionSchema.index({ branchId: 1 }, { name: 'one_open_cash_day', unique: true, partialFilterExpression: { status: 'OPEN' } });

export default mongoose.model('CashSession', cashSessionSchema);
