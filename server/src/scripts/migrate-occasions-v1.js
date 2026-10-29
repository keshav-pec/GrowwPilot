// Gets existing customers ready for Birthday & Anniversary Offers. Safe to run any number of times:
// each step only touches customers that still need it.
//   - The old full date of birth becomes the birthday month + day (read in UTC, as it was saved), marked MIGRATED.
//     The old date stays in the database but is no longer shown. A birthday that was cleared (null) is left alone.
//   - Every customer gets a home branch: the branch of their latest appointment, otherwise the salon's first active branch.
//   - Every channel with no permission recorded is set to "not recorded" (UNKNOWN). Permission is never guessed
//     from a phone number or past visits.
// It runs by itself when the server starts and at the end of the seed. To run it by hand:
//   npm run migrate:occasions
import mongoose from 'mongoose';
import { pathToFileURL } from 'node:url';
import { Appointment, Branch, Customer } from '../models/index.js';
import { CONSENT_CHANNELS } from '../config/occasions.js';

const BATCH = 1000;

// The salon's first active branch (or its first branch at all, for a salon with none active)
async function fallbackBranches() {
  const branches = await Branch.find({}).select('orgId status createdAt').sort({ createdAt: 1, _id: 1 }).lean();
  const result = new Map();
  for (const b of branches) {
    const org = String(b.orgId);
    const current = result.get(org);
    if (!current || (current.status !== 'active' && b.status === 'active')) result.set(org, b);
  }
  return { first: new Map([...result].map(([org, b]) => [org, b._id])), active: new Set(branches.filter((b) => b.status === 'active').map((b) => String(b._id))) };
}

async function setHomeBranches() {
  const { first, active } = await fallbackBranches();
  // Salons with no branch at all have nothing to give, so they are left out
  const filter = { homeBranchId: null, orgId: { $in: [...first.keys()].map((id) => new mongoose.Types.ObjectId(id)) } };
  let updated = 0;
  // Always the first batch still without one: each pass gives every one of them a branch
  for (;;) {
    const customers = await Customer.collection.find(filter, { projection: { orgId: 1 } }).limit(BATCH).toArray();
    if (customers.length === 0) break;
    const latest = await Appointment.aggregate([
      { $match: { customerId: { $in: customers.map((c) => c._id) } } },
      { $sort: { startAt: -1 } },
      { $group: { _id: '$customerId', branchId: { $first: '$branchId' } } },
    ]);
    const latestOf = new Map(latest.map((a) => [String(a._id), a.branchId]));
    const ops = customers.map((c) => {
      const fromVisit = latestOf.get(String(c._id));
      const branchId = fromVisit && active.has(String(fromVisit)) ? fromVisit : first.get(String(c.orgId));
      return { updateOne: { filter: { _id: c._id, homeBranchId: null }, update: { $set: { homeBranchId: branchId } } } };
    });
    const result = await Customer.collection.bulkWrite(ops, { ordered: false });
    updated += result.modifiedCount;
  }
  return updated;
}

export async function migrateOccasions({ log = console.log } = {}) {
  const now = new Date();

  // 1. Date of birth -> birthday month and day (UTC, as dates of birth were saved at midnight UTC)
  const birthdays = await Customer.collection.updateMany({ dob: { $type: 'date' }, 'occasions.birthday': { $exists: false } }, [
    { $set: { 'occasions.birthday': { month: { $month: '$dob' }, day: { $dayOfMonth: '$dob' }, source: 'MIGRATED', updatedAt: now } } },
  ]);

  // 2. Home branch
  const homes = await setHomeBranches();

  // 3. Messaging permission: "not recorded" wherever nothing is saved yet
  let channels = 0;
  for (const channel of CONSENT_CHANNELS) {
    const result = await Customer.collection.updateMany({ [`marketing.${channel}.status`]: { $exists: false } }, { $set: { [`marketing.${channel}`]: { status: 'UNKNOWN' } } });
    channels += result.modifiedCount;
  }

  if (birthdays.modifiedCount) log(`Occasions: copied ${birthdays.modifiedCount} date${birthdays.modifiedCount === 1 ? '' : 's'} of birth into birthday month and day`);
  if (homes) log(`Occasions: gave ${homes} customer${homes === 1 ? '' : 's'} a home branch`);
  if (channels) log(`Occasions: marked messaging permission as not recorded on ${channels} customer channel${channels === 1 ? '' : 's'}`);
  return { birthdays: birthdays.modifiedCount, homeBranches: homes, channels };
}

// Run by hand: npm run migrate:occasions
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { connectDB } = await import('../config/db.js');
  await connectDB();
  await migrateOccasions();
  await mongoose.disconnect();
}
