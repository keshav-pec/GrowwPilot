// Starts a throwaway MongoDB (a replica set, because transactions need one) and fills it with test data.
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import * as models from '../src/models/index.js';

const { Organization, Branch, Staff, Service, Combo, Customer } = models;

let replSet;

export async function startDb() {
  replSet = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: 'wiredTiger' } });
  await mongoose.connect(replSet.getUri());
  // Create collections and indexes up front (collections can't be created inside every transaction)
  await Promise.all(Object.values(models).map((model) => model.init()));
}

export async function stopDb() {
  await mongoose.disconnect();
  await replSet?.stop();
}

// Two salons: Glamour (Mumbai, India time) and Desert Rose (Dubai time)
export async function createFixtures() {
  const glamour = await Organization.create({ name: 'Glamour', slug: 'glamour', ownerName: 'A', contactEmail: 'a@a.com' });
  const [andheri, bandra] = await Branch.create([
    { orgId: glamour._id, name: 'Andheri', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00', defaultServiceMinutes: 30 },
    { orgId: glamour._id, name: 'Bandra', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '20:00' },
  ]);
  const [rahul, neha, arjun, ravi] = await Staff.create([
    { orgId: glamour._id, branchId: andheri._id, name: 'Rahul' },
    { orgId: glamour._id, branchId: andheri._id, name: 'Neha' },
    { orgId: glamour._id, branchId: bandra._id, name: 'Arjun' },
    { orgId: glamour._id, branchId: andheri._id, name: 'Ravi', status: 'inactive' },
  ]);
  const [haircut, beardTrim, facial] = await Service.create([
    { orgId: glamour._id, name: 'Haircut', durationMinutes: 45, price: 50000 },
    { orgId: glamour._id, name: 'Beard Trim', price: 20000 }, // no duration: branch default (30 min)
    { orgId: glamour._id, name: 'Facial', durationMinutes: 60, price: 120000, branchIds: [bandra._id] }, // Bandra only
  ]);
  const combo = await Combo.create({ orgId: glamour._id, name: 'Cut + Beard', serviceIds: [haircut._id, beardTrim._id], comboPrice: 60000 });
  const priya = await Customer.create({ orgId: glamour._id, name: 'Priya', phone: '9876543210' });

  const desertRose = await Organization.create({ name: 'Desert Rose', slug: 'desert-rose', ownerName: 'B', contactEmail: 'b@b.com' });
  const marina = await Branch.create({ orgId: desertRose._id, name: 'Marina', timezone: 'Asia/Dubai', openTime: '09:00', closeTime: '22:00' });
  const omar = await Staff.create({ orgId: desertRose._id, branchId: marina._id, name: 'Omar' });
  const dubaiHaircut = await Service.create({ orgId: desertRose._id, name: 'Haircut', durationMinutes: 30, price: 80000 });
  const fatima = await Customer.create({ orgId: desertRose._id, name: 'Fatima', phone: '9123456780' });

  // What tenantContext would build for each salon's owner
  const ctxGlamour = {
    orgId: String(glamour._id),
    userId: String(new mongoose.Types.ObjectId()),
    allowedBranchIds: [String(andheri._id), String(bandra._id)],
    activeBranchId: String(andheri._id),
  };
  const ctxDesert = {
    orgId: String(desertRose._id),
    userId: String(new mongoose.Types.ObjectId()),
    allowedBranchIds: [String(marina._id)],
    activeBranchId: String(marina._id),
  };

  return { ctxGlamour, ctxDesert, andheri, bandra, marina, rahul, neha, arjun, ravi, omar, haircut, beardTrim, facial, dubaiHaircut, combo, priya, fatima };
}
