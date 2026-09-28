// Wipes the database and fills it with a small set of demo data.
// Run with: npm run seed
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';
import { connectDB } from '../config/db.js';
import { toPaise } from '../utils/money.js';
import * as models from '../models/index.js';

const { Organization, Branch, User, Staff, Service, Combo, Customer } = models;

const DEMO_PASSWORD = 'Password@123';

// Safety check: never wipe the production database by accident
if (env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
  console.error('Refusing to seed in production. Run "npm run seed -- --force" if you really mean it.');
  process.exit(1);
}

await connectDB();

// 1. Start from an empty database, then rebuild every index
await mongoose.connection.dropDatabase();
await Promise.all(Object.values(models).map((model) => model.syncIndexes()));
console.log('Database wiped and indexes created');

const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

// 2. Super Admin (belongs to no salon)
await User.create({
  role: 'SUPER_ADMIN',
  name: 'GrowwPilot Admin',
  email: 'admin@growwpilot.com',
  passwordHash,
});

// 3. Salon 1: Glamour Studio, Mumbai (two branches, India time)
const glamour = await Organization.create({
  name: 'Glamour Studio',
  slug: 'glamour-studio',
  ownerName: 'Anita Mehra',
  contactEmail: 'owner@glamour.com',
  contactPhone: '9820012345',
  city: 'Mumbai',
  plan: 'pro',
});

const [andheri, bandra] = await Branch.create([
  { orgId: glamour._id, name: 'Andheri', address: 'Lokhandwala Market, Andheri West', city: 'Mumbai', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00' },
  { orgId: glamour._id, name: 'Bandra', address: 'Hill Road, Bandra West', city: 'Mumbai', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '20:00' },
]);

await User.create([
  { orgId: glamour._id, role: 'OWNER', name: 'Anita Mehra', email: 'owner@glamour.com', passwordHash, allBranches: true },
  { orgId: glamour._id, role: 'FRONT_DESK', name: 'Kavya (Andheri desk)', email: 'desk.andheri@glamour.com', passwordHash, branchIds: [andheri._id] },
]);

await Staff.create([
  { orgId: glamour._id, branchId: andheri._id, name: 'Rahul', role: 'Stylist', phone: '9811111111' },
  { orgId: glamour._id, branchId: andheri._id, name: 'Neha', role: 'Beautician', phone: '9822222222' },
  { orgId: glamour._id, branchId: bandra._id, name: 'Arjun', role: 'Stylist', phone: '9833333333' },
]);

const [haircut, beardTrim] = await Service.create([
  { orgId: glamour._id, name: 'Haircut', category: 'Hair', durationMinutes: 45, price: toPaise(500) },
  { orgId: glamour._id, name: 'Beard Trim', category: 'Grooming', price: toPaise(200) }, // no duration: branch default is used
  { orgId: glamour._id, name: 'Hair Colour', category: 'Hair', durationMinutes: 90, price: toPaise(2500) },
  { orgId: glamour._id, name: 'Facial', category: 'Skin', durationMinutes: 60, price: toPaise(1200), branchIds: [andheri._id] }, // Andheri only
]);

await Combo.create({
  orgId: glamour._id,
  name: 'Haircut + Beard Trim',
  serviceIds: [haircut._id, beardTrim._id],
  comboPrice: toPaise(600),
});

await Customer.create([
  { orgId: glamour._id, name: 'Priya Sharma', phone: '+91 98765 43210' }, // saved as 9876543210
  { orgId: glamour._id, name: 'Amit Verma', phone: '9123456780' },
]);

// 4. Salon 2: Desert Rose, Dubai (one branch, Dubai time, to test timezone handling)
const desertRose = await Organization.create({
  name: 'Desert Rose Salon',
  slug: 'desert-rose',
  ownerName: 'Fatima Khan',
  contactEmail: 'owner@desertrose.com',
  city: 'Dubai',
  plan: 'basic',
});

const marina = await Branch.create({
  orgId: desertRose._id,
  name: 'Dubai Marina',
  address: 'Marina Walk',
  city: 'Dubai',
  timezone: 'Asia/Dubai',
  openTime: '09:00',
  closeTime: '22:00',
});

await User.create([
  { orgId: desertRose._id, role: 'OWNER', name: 'Fatima Khan', email: 'owner@desertrose.com', passwordHash, allBranches: true },
  { orgId: desertRose._id, role: 'FRONT_DESK', name: 'Sara (Marina desk)', email: 'desk@desertrose.com', passwordHash, branchIds: [marina._id] },
]);

await Staff.create([
  { orgId: desertRose._id, branchId: marina._id, name: 'Omar', role: 'Stylist' },
  { orgId: desertRose._id, branchId: marina._id, name: 'Layla', role: 'Beautician' },
]);

await Service.create([
  { orgId: desertRose._id, name: 'Haircut', category: 'Hair', durationMinutes: 30, price: toPaise(800) },
  { orgId: desertRose._id, name: 'Manicure', category: 'Nails', durationMinutes: 45, price: toPaise(1000) },
]);

// Same phone as Priya at Glamour Studio: allowed, because it's a different salon
await Customer.create({ orgId: desertRose._id, name: 'Priya Sharma', phone: '9876543210' });

// 5. Print the login details
console.log('\nSeed complete. Every account uses the password:', DEMO_PASSWORD);
console.table([
  { role: 'Super Admin', email: 'admin@growwpilot.com', salon: '-' },
  { role: 'Owner', email: 'owner@glamour.com', salon: 'Glamour Studio (Andheri, Bandra)' },
  { role: 'Front Desk', email: 'desk.andheri@glamour.com', salon: 'Glamour Studio (Andheri)' },
  { role: 'Owner', email: 'owner@desertrose.com', salon: 'Desert Rose (Dubai Marina)' },
  { role: 'Front Desk', email: 'desk@desertrose.com', salon: 'Desert Rose (Dubai Marina)' },
]);

await mongoose.disconnect();
