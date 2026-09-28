import mongoose from 'mongoose';
import { ref, money } from './fields.js';
import { APPOINTMENT_SOURCES, APPOINTMENT_STATUSES } from '../config/constants.js';

// One service inside an appointment. Name, staff name and price are copied here (a "snapshot"),
// so old appointments still read correctly after a service or staff member changes.
const itemSchema = new mongoose.Schema({
  serviceId: ref('Service', { required: true }),
  serviceName: { type: String, required: true },
  staffId: ref('Staff', { required: true }),
  staffName: { type: String, required: true },
  startAt: { type: Date, required: true }, // UTC
  endAt: { type: Date, required: true }, // UTC
  durationMinutes: { type: Number, required: true, min: 5 },
  price: money({ required: true }),
});

// Every status change is recorded: who changed it, when, and why
const statusChangeSchema = new mongoose.Schema(
  {
    from: { type: String, enum: APPOINTMENT_STATUSES },
    to: { type: String, enum: APPOINTMENT_STATUSES, required: true },
    by: ref('User'),
    at: { type: Date, default: Date.now },
    reason: String,
  },
  { _id: false }
);

const appointmentSchema = new mongoose.Schema(
  {
    orgId: ref('Organization', { required: true }),
    branchId: ref('Branch', { required: true }),
    customerId: ref('Customer', { required: true }),
    customerSnapshot: {
      name: { type: String, required: true },
      phone: { type: String, required: true },
    },
    items: {
      type: [itemSchema],
      validate: { validator: (items) => items.length > 0, message: 'An appointment needs at least one service' },
    },
    comboId: ref('Combo'), // set when a combo was booked
    startAt: { type: Date, required: true }, // start of the first item (UTC)
    endAt: { type: Date, required: true }, // end of the last item (UTC)
    totalPrice: money({ required: true }), // the combo price for combos, otherwise the sum of items
    status: { type: String, enum: APPOINTMENT_STATUSES, default: 'BOOKED' },
    statusHistory: [statusChangeSchema],
    source: { type: String, enum: APPOINTMENT_SOURCES, default: 'phone' },
    leadId: ref('Lead'),
    notes: { type: String, trim: true },
    createdBy: ref('User'),
  },
  { timestamps: true }
);

appointmentSchema.index({ orgId: 1, branchId: 1, startAt: 1 }); // day board and list
appointmentSchema.index({ 'items.staffId': 1, 'items.startAt': 1 }); // conflict check for a stylist

export default mongoose.model('Appointment', appointmentSchema);
