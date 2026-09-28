import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { Branch, Customer, Organization, Staff, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { generateTempPassword, hashPassword } from '../../utils/password.js';

// Makes user input safe to use inside a regular expression ("a.b" should match a dot, not any character)
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// "Glamour Studio!" -> "glamour-studio"
function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Search by salon name, city or owner email, and filter by status
export function listOrgs({ search, status }) {
  const filter = {};
  if (status) filter.status = status;
  if (search) {
    const pattern = new RegExp(escapeRegex(search), 'i'); // 'i' = ignore upper/lower case
    filter.$or = [{ name: pattern }, { city: pattern }, { contactEmail: pattern }];
  }
  return Organization.find(filter).sort({ createdAt: -1 }).lean();
}

// Salon details, plus a few counts for the detail page
export async function getOrg(id) {
  const org = await Organization.findById(id).lean();
  if (!org) throw new AppError(404, 'NOT_FOUND', 'Salon not found');

  const [branches, staffCount, customerCount, userCount] = await Promise.all([
    Branch.find({ orgId: id }).select('name city timezone status').sort('name').lean(),
    Staff.countDocuments({ orgId: id, status: { $ne: 'archived' } }),
    Customer.countDocuments({ orgId: id }),
    User.countDocuments({ orgId: id }),
  ]);

  return { ...org, branches, counts: { branches: branches.length, staff: staffCount, customers: customerCount, users: userCount } };
}

// Onboarding: creates the salon, its first branch and its primary owner.
// It runs in a TRANSACTION: if any step fails (e.g. the email is taken), nothing is saved.
export async function createOrg(input) {
  const temporaryPassword = generateTempPassword();
  const passwordHash = await hashPassword(temporaryPassword);

  const org = await mongoose.connection.transaction(async (session) => {
    const emailTaken = await User.exists({ email: input.ownerEmail }).session(session);
    if (emailTaken) {
      throw new AppError(409, 'EMAIL_TAKEN', 'A user with this email already exists');
    }

    // Two salons can have the same name, so add a short random ending if the slug is taken
    let slug = slugify(input.name);
    if (await Organization.exists({ slug }).session(session)) {
      slug = `${slug}-${crypto.randomBytes(2).toString('hex')}`;
    }

    // create([...], { session }) is how Mongoose saves inside a transaction
    const [newOrg] = await Organization.create(
      [
        {
          name: input.name,
          slug,
          ownerName: input.ownerName,
          contactEmail: input.ownerEmail,
          contactPhone: input.ownerPhone || undefined,
          city: input.city,
          plan: input.plan,
        },
      ],
      { session }
    );

    await Branch.create(
      [
        {
          orgId: newOrg._id,
          name: input.branchName,
          address: input.branchAddress,
          city: input.city,
          timezone: input.timezone,
        },
      ],
      { session }
    );

    await User.create(
      [
        {
          orgId: newOrg._id,
          role: 'OWNER',
          name: input.ownerName,
          email: input.ownerEmail,
          phone: input.ownerPhone || undefined,
          passwordHash,
          allBranches: true, // the primary owner sees every branch
        },
      ],
      { session }
    );

    return newOrg;
  });

  // The temporary password is shown once to the Super Admin and never stored in plain text
  return { org, ownerEmail: input.ownerEmail, temporaryPassword };
}

// Activate or deactivate a salon. Its users are locked out on their very next request (see requireAuth).
export async function setOrgStatus(id, status) {
  const org = await Organization.findByIdAndUpdate(id, { status }, { new: true }).lean();
  if (!org) throw new AppError(404, 'NOT_FOUND', 'Salon not found');
  return org;
}
