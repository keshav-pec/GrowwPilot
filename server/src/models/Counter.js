import mongoose from 'mongoose';

// A named number that only goes up, e.g. { _id: 'invoice:<branchId>', seq: 123 }.
// Used for invoice numbers like GP-AND-000123.
const counterSchema = new mongoose.Schema({
  _id: { type: String, required: true },
  seq: { type: Number, default: 0 },
});

export default mongoose.model('Counter', counterSchema);
