// Small field definitions that several models share.
import mongoose from 'mongoose';
import { normalizePhone, PHONE_REGEX } from '../utils/phone.js';

const { ObjectId } = mongoose.Schema.Types;

// A reference to another collection, e.g. ref('Branch')
export function ref(model, options = {}) {
  return { type: ObjectId, ref: model, ...options };
}

// Money in whole paise. Must be a whole number and never negative.
export function money(options = {}) {
  return {
    type: Number,
    min: 0,
    validate: { validator: Number.isInteger, message: '{PATH} must be a whole number of paise' },
    ...options,
  };
}

// A phone number that is cleaned up automatically before saving ("+91 98765 43210" -> "9876543210")
export function phone(options = {}) {
  return {
    type: String,
    set: normalizePhone,
    match: [PHONE_REGEX, 'Phone must be a valid 10-digit mobile number'],
    ...options,
  };
}

// "HH:mm" in 24-hour time, e.g. "09:00" or "21:30"
export const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;
