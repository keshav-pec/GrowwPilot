import mongoose from 'mongoose';
import { ref } from '../fields.js';

// One row per branch for the monthly offer run: a lock (so two servers never run the same branch at once)
// and the local day it last ran (so it runs once a day, and catches up after downtime).
const occasionEngineRunSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    lockedUntil: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    lastRunDate: { type: String, default: null }, // "2026-11-01" in the branch's time
    lastRunAt: Date,
  },
  { collection: 'occasion_engine_runs' }
);

occasionEngineRunSchema.index({ branchId: 1 }, { unique: true });

export default mongoose.model('OccasionEngineRun', occasionEngineRunSchema);
