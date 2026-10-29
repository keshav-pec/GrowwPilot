import mongoose from 'mongoose';
import { money, ref } from '../fields.js';
import { DISCOUNT_TYPES } from '../../config/occasions.js';

// The terms of an occasion offer. PERCENT: value is in basis points (1500 = 15%) and maxDiscount is needed.
// FLAT: value is in paise. minSubtotal is the eligible spend needed (before GST). serviceIds: the services that count.
export const campaignRulesSchema = new mongoose.Schema(
  {
    discountType: { type: String, enum: DISCOUNT_TYPES, required: true },
    value: { type: Number, required: true, min: 1, validate: { validator: Number.isInteger, message: '{PATH} must be a whole number' } },
    maxDiscount: money({ default: null }),
    minSubtotal: money({ default: 0 }),
    serviceIds: { type: [ref('Service')], default: [] },
  },
  { _id: false }
);
