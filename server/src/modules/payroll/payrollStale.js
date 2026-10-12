import { PayrollRun } from '../../models/index.js';

// Something that changes pay happened at this branch (pay setup, attendance, a paid bill, an advance):
// make every draft month there work itself out again the next time it's opened. Locked months never change.
export async function markPayrollStale(orgId, branchId) {
  await PayrollRun.updateMany({ orgId, branchId, status: 'draft' }, { $set: { calculatedAt: new Date(0) } });
}
