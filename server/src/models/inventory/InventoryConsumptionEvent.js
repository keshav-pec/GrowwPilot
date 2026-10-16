import mongoose from 'mongoose';
import { appendOnly, ref } from '../fields.js';

// Every automatic use of stock by a completed service, with the recipe version and amount it used.
// key = salon + branch + appointment + service line + recipe line, unique: a replayed event never uses stock twice.
// A correction ("used 110 ml, not 90") is another row with correctsId and only the difference.
const inventoryConsumptionEventSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    key: { type: String, required: true },
    appointmentId: ref('Appointment', { required: true }),
    serviceLineId: { type: mongoose.Schema.Types.ObjectId, required: true }, // the appointment item
    serviceId: ref('Service'),
    serviceName: String,
    staffId: ref('Staff'),
    staffName: String,
    recipeId: ref('InventoryRecipe'),
    recipeVersion: Number,
    recipeLineId: mongoose.Schema.Types.ObjectId,
    skuId: ref('InventorySku', { required: true }),
    wayOfUse: String,
    qty: { type: Number, required: true }, // counting units; a correction can be negative
    useStoreIfNeeded: Boolean,
    // Where it came from: open hand-outs (for measured products) and/or the store
    sources: [{ _id: false, allocationId: ref('InventoryAllocation'), qty: Number }],
    transactionId: ref('InventoryTransaction', { required: true }),
    correctsId: ref('InventoryConsumptionEvent', { default: null }),
    completedAt: Date,
    note: String,
    createdAt: { type: Date, default: Date.now },
  },
  { collection: 'inventory_consumption_events' }
);

inventoryConsumptionEventSchema.index({ orgId: 1, key: 1 }, { unique: true });
inventoryConsumptionEventSchema.index({ orgId: 1, transactionId: 1 });
inventoryConsumptionEventSchema.index({ orgId: 1, correctsId: 1 });
appendOnly(inventoryConsumptionEventSchema, 'An automatic stock use');

export default mongoose.model('InventoryConsumptionEvent', inventoryConsumptionEventSchema);
