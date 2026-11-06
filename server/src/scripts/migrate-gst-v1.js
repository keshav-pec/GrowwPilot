// Moves each branch's GSTIN from Billing settings into dated GST registrations, so GST setup is the one place to edit them.
// Safe to run any number of times: a branch that is already linked is skipped. Bills don't change.
// It runs by itself when the server starts. To run it by hand:
//   npm run migrate:gst
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { BillingSettings } from '../models/index.js';
import { moveBranchGstins } from '../modules/gst/gst.service.js';

export async function migrateGst({ log = console.log } = {}) {
  const salons = await BillingSettings.find({ 'branches.gstin': { $type: 'string' } }).distinct('orgId');
  let moved = 0;
  for (const orgId of salons) {
    moved += await mongoose.connection.transaction((session) => moveBranchGstins(orgId, session));
  }
  if (moved) log(`GST: moved ${moved} branch GSTIN${moved === 1 ? '' : 's'} into GST registrations`);
  return { moved };
}

// Run by hand: npm run migrate:gst
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  await migrateGst();
  await mongoose.disconnect();
}
