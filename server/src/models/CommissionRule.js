import mongoose from 'mongoose';
import { ref } from './fields.js';

// A special commission rate for one person on one service, e.g. Rahul gets 15% on Hair Colour.
// It beats their normal % from the pay setup. 0 = no commission on that service.
const commissionRuleSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    staffId: ref('Staff', { required: true }),
    serviceId: ref('Service', { required: true }),
    rateBps: { type: Number, required: true, min: 0, max: 10000, validate: { validator: Number.isInteger, message: 'Rate must be whole basis points' } },
    updatedBy: ref('User'),
  },
  { timestamps: true }
);

commissionRuleSchema.index({ staffId: 1, serviceId: 1 }, { unique: true });

export default mongoose.model('CommissionRule', commissionRuleSchema);
