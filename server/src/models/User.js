import mongoose from 'mongoose';
import { ref } from './fields.js';
import { ROLES } from '../config/constants.js';

// Someone who can log in: Super Admin, Owner or Front Desk.
const userSchema = new mongoose.Schema(
  {
    // Every user belongs to a salon, except the Super Admin
    orgId: ref('Organization', {
      default: null,
      required: function () {
        return this.role !== 'SUPER_ADMIN';
      },
    }),
    role: { type: String, enum: ROLES, required: true },
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true },
    // select: false = never returned by queries unless we ask for it with .select('+passwordHash')
    passwordHash: { type: String, required: true, select: false },
    allBranches: { type: Boolean, default: false }, // true for the primary owner
    branchIds: [ref('Branch')], // branches this user may work in (front desk: exactly one)
    status: { type: String, enum: ['active', 'inactive'], default: 'active' },
  },
  { timestamps: true }
);

export default mongoose.model('User', userSchema);
