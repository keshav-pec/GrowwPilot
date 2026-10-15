import mongoose from 'mongoose';
import { ref } from '../fields.js';
import { WRITE_OFF_REASONS } from '../../config/inventory.js';
import { wholeNumber } from './wholeNumber.js';

// Something waiting for someone:
// WRITE_OFF       a write-off above the person's limit, waiting for an owner's approval
// PROBLEM_REPORT  the front desk reported a problem (broken, lost...); an owner or inventory login looks at it
const personSchema = new mongoose.Schema({ id: ref('User'), name: String, role: String }, { _id: false });

const inventoryApprovalSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    kind: { type: String, enum: ['WRITE_OFF', 'PROBLEM_REPORT'], required: true },
    // PENDING -> APPROVED / REJECTED (write-off), or RESOLVED / DISMISSED (problem report)
    status: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED', 'RESOLVED', 'DISMISSED'], default: 'PENDING' },

    skuId: ref('InventorySku', { required: true }),
    skuName: String,
    locationId: ref('InventoryLocation', { default: null }), // a store...
    allocationId: ref('InventoryAllocation', { default: null }), // ...or a hand-out in use
    qty: wholeNumber({ default: null }),
    direction: { type: String, enum: ['REMOVE', 'ADD'], default: 'REMOVE' },
    reason: { type: String, enum: [...WRITE_OFF_REASONS, 'OTHER'] },
    note: String,
    value: { type: Number, default: null }, // paise, when the cost is known

    requestedBy: personSchema,
    decidedBy: { type: personSchema, default: null },
    decidedAt: { type: Date, default: null },
    decisionNote: String,
    transactionId: ref('InventoryTransaction', { default: null }), // the movement posted when approved
  },
  { timestamps: true, collection: 'inventory_approvals' }
);

inventoryApprovalSchema.index({ orgId: 1, branchId: 1, status: 1, createdAt: -1 });

export default mongoose.model('InventoryApproval', inventoryApprovalSchema);
