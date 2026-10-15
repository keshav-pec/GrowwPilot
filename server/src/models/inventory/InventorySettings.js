import mongoose from 'mongoose';
import { money, ref } from '../fields.js';

// Inventory rules for one branch: what the front desk may do, and the approval limits.
// A branch without a row uses the defaults below (see inventory/settings.js).
const inventorySettingsSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),

    // "Delegated" jobs the front desk may do (PRD launch defaults: only marking bottles finished).
    // Reporting a problem is always allowed and has no switch.
    frontDesk: {
      finish: { type: Boolean, default: true }, // mark finished (and replace)
      issue: { type: Boolean, default: false }, // issue to a station or stylist, and return unused stock
      transfer: { type: Boolean, default: false }, // move a hand-out to another stylist or station
      receive: { type: Boolean, default: false }, // receive deliveries
    },

    // Approval limits, in paise, per action. Above the limit an owner has to approve.
    limits: {
      inventoryWriteOff: money({ default: 200000 }), // inventory login: use / write off / adjust up to ₹2,000
      branchOwnerWriteOff: money({ default: 1000000 }), // branch owner: up to ₹10,000
      branchOwnerPoApproval: money({ default: 2500000 }), // branch owner approves orders up to ₹25,000
    },

    branchOwnerSeesCosts: { type: Boolean, default: true }, // PRD: "own branch; configurable"
    setupCompletedAt: { type: Date, default: null }, // first-time setup guide finished (Phase 3)
  },
  { timestamps: true, collection: 'inventory_settings' }
);

inventorySettingsSchema.index({ orgId: 1, branchId: 1 }, { unique: true });

export default mongoose.model('InventorySettings', inventorySettingsSchema);
