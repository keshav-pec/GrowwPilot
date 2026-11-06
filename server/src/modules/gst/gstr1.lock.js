import { GstReturn } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';

export const RETURN_LINK = (id) => `/app/gst/returns/${id}`;

// Is this month closed for this GSTIN? Direct changes are refused, and point to an adjustment case.
export async function assertMonthOpen(orgId, gstin, period, session = null) {
  const filed = await GstReturn.findOne({ orgId, gstin, period, status: 'FILED' }).select('_id').session(session).lean();
  if (filed) throw new AppError(409, 'FILED_PERIOD_LOCKED', `GSTR-1 for ${period} has been filed, so this can’t be changed directly. Create an adjustment case.`, { returnId: filed._id, link: RETURN_LINK(filed._id) });
}
