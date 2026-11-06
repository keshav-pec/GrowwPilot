// Moves each branch's GSTIN from Billing settings into dated GST registrations, so GST setup is the one place to edit them.
// Salons with GST setup active get their older GST bills added to the permanent tax record.
// Safe to run any number of times: a linked branch or a bill already in the record is skipped. Bills don't change.
// It runs by itself when the server starts. To run it by hand:
//   npm run migrate:gst
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { BillingSettings } from '../models/index.js';
import { moveBranchGstins } from '../modules/gst/gst.service.js';
import { addOlderDocuments } from '../modules/gst/gst.ledger.js';

export async function migrateGst({ log = console.log } = {}) {
  const salons = await BillingSettings.find({ 'branches.gstin': { $type: 'string' } }).distinct('orgId');
  let moved = 0;
  for (const orgId of salons) {
    moved += await mongoose.connection.transaction((session) => moveBranchGstins(orgId, session));
  }
  if (moved) log(`GST: moved ${moved} branch GSTIN${moved === 1 ? '' : 's'} into GST registrations`);

  // A salon that activated before the tax record existed: its record begins now, with everything earlier added
  await BillingSettings.updateMany({ 'gst.status': 'ACTIVE', 'gst.recordFrom': null }, { $set: { 'gst.recordFrom': new Date() } });
  let added = 0;
  for (const settings of await BillingSettings.find({ 'gst.status': 'ACTIVE' }).lean()) {
    added += (await addOlderDocuments(settings.orgId, settings)).added;
  }
  if (added) log(`GST: added ${added} older document${added === 1 ? '' : 's'} to the tax record`);
  return { moved, added };
}

// Run by hand: npm run migrate:gst
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  await migrateGst();
  await mongoose.disconnect();
}
