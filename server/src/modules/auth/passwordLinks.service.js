import crypto from 'node:crypto';
import mongoose from 'mongoose';
import { env } from '../../config/env.js';
import { EmailOutbox, Organization, PasswordToken, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { hashPassword } from '../../utils/password.js';
import { mailMode } from '../mail/config.js';
import { escapeHtml, layout, textToHtml } from '../mail/html.js';
import { kickMailer, onResult, queueEmail } from '../mail/outbox.js';

// One-time links to choose a password (EMAIL_PLAN.md Part 4):
//   RESET  — "Forgot password?" on the login page, valid 1 hour
//   INVITE — an owner emails a team member a link to set their password, valid 48 hours
// The link holds a random token; only its hash is stored. A new link cancels the person's older ones.
// Using a link sets the password and logs the person out everywhere else (User.passwordChangedAt).

const LIFETIME_MS = { RESET: 60 * 60 * 1000, INVITE: 48 * 60 * 60 * 1000 };
const RESETS_PER_HOUR = 3; // per person: more "Forgot password?" requests in an hour are ignored (same reply)
const hashToken = (token) => crypto.createHash('sha256').update(String(token)).digest('hex');

// Password rules (there were none before: temporary passwords are random)
export const PASSWORD_RULE = 'At least 8 characters, with a letter and a number';
export function passwordProblem(password) {
  const text = String(password ?? '');
  if (text.length < 8 || text.length > 72 || !/[A-Za-z]/.test(text) || !/\d/.test(text)) return PASSWORD_RULE;
  return null;
}

// Password emails need a real way to send (in development they are printed)
export const passwordEmailsAvailable = () => mailMode() !== 'off';

// Makes a link for the user and queues the email, in one transaction
async function issueLink(user, purpose, { by = null } = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = new Date();
  const org = await Organization.findById(user.orgId).select('name contactEmail').lean();
  const link = `${env.CLIENT_ORIGIN}/reset-password?token=${token}`;
  const email = passwordEmail({ purpose, user, org, by, link });
  const ctx = { orgId: String(user.orgId), userId: by ? String(by._id) : null, userName: by?.name ?? 'GrowwPilot' };

  await mongoose.connection.transaction(async (session) => {
    await PasswordToken.updateMany({ userId: user._id, usedAt: null, cancelledAt: null }, { $set: { cancelledAt: now } }, { session });
    const [row] = await PasswordToken.create(
      [{ userId: user._id, orgId: user.orgId, purpose, tokenHash: hashToken(token), expiresAt: new Date(now.getTime() + LIFETIME_MS[purpose]), createdBy: by ? { id: by._id, name: by.name } : undefined }],
      { session }
    );
    await queueEmail(
      ctx,
      {
        kind: 'PASSWORD',
        priority: 1,
        dedupeKey: `password:${row._id}`,
        to: user.email,
        subject: email.subject,
        text: email.text,
        html: email.html,
        fromName: 'GrowwPilot',
        replyTo: org?.contactEmail,
        ref: { userId: user._id },
      },
      session
    );
  });
  kickMailer();
}

function passwordEmail({ purpose, user, org, by, link }) {
  const salon = org?.name ?? 'your salon';
  const text =
    purpose === 'RESET'
      ? `Hi ${user.name},\n\nSomeone (hopefully you) asked to reset your GrowwPilot password for ${salon}.\n\nChoose a new password here (the link works once, for 1 hour):\n${link}\n\nIf you didn't ask, ignore this email. Your password stays the same.`
      : `Hi ${user.name},\n\n${by?.name ?? 'Your salon'} added you to ${salon} on GrowwPilot. Your login is ${user.email}.\n\nSet your password here (the link works once, for 48 hours):\n${link}\n\nIf the link has expired, ask ${by?.name ?? 'your salon owner'} to send a new one.`;
  const button = `<p style="margin:20px 0;"><a href="${escapeHtml(link)}" style="display:inline-block;padding:10px 18px;border-radius:8px;background:#c9a227;color:#111111;font-weight:600;text-decoration:none;">${purpose === 'RESET' ? 'Choose a new password' : 'Set your password'}</a></p>`;
  const html = layout({
    salonName: 'GrowwPilot',
    body: `${textToHtml(text.split(link)[0])}${button}${textToHtml(text.split(link)[1] ?? '')}`,
    footer: `Sent by GrowwPilot for ${escapeHtml(salon)}. Replies go to the salon.`,
  });
  return { subject: purpose === 'RESET' ? 'Reset your GrowwPilot password' : `Set your GrowwPilot password for ${salon}`, text, html };
}

// POST /api/auth/forgot-password — always answers the same, whether or not the email has an account.
// Nothing is sent to deactivated accounts, the Super Admin, or after 3 requests in an hour.
// The work happens after the reply, so the reply time doesn't give anything away either.
export function requestReset(email) {
  setImmediate(() =>
    sendResetIfAllowed(email).catch((err) => console.error('Forgot password: could not send the email:', err.message))
  );
  return { message: 'If an account exists for this email, we’ve emailed a link to reset the password.' };
}

export async function sendResetIfAllowed(email) {
  if (!passwordEmailsAvailable()) return false;
  const user = await User.findOne({ email: String(email).trim().toLowerCase(), status: 'active', role: { $ne: 'SUPER_ADMIN' } }).select('name email orgId').lean();
  if (!user?.orgId) return false;
  const org = await Organization.findById(user.orgId).select('status').lean();
  if (org?.status !== 'active') return false;
  const recent = await PasswordToken.countDocuments({ userId: user._id, purpose: 'RESET', createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } });
  if (recent >= RESETS_PER_HOUR) return false;
  await issueLink(user, 'RESET');
  return true;
}

// An owner emails a team member a set-password link (same people they may reset today)
export async function emailPasswordLink(user, by) {
  if (!passwordEmailsAvailable()) throw new AppError(409, 'MAIL_NOT_SET_UP', 'Email isn’t set up yet. Use Reset password and share the temporary password instead.');
  if (user.status !== 'active') throw new AppError(409, 'USER_INACTIVE', 'Activate this login first');
  await issueLink(user, 'INVITE', { by });
  return { email: user.email, emailed: true };
}

// A link that can still be used, or null
async function usableToken(token) {
  if (typeof token !== 'string' || token.length < 20 || token.length > 100) return null;
  return PasswordToken.findOne({ tokenHash: hashToken(token), usedAt: null, cancelledAt: null, expiresAt: { $gt: new Date() } }).lean();
}

const LINK_INVALID = () => new AppError(400, 'LINK_INVALID', 'This link has expired or was already used. Ask for a new one.');

// POST /api/auth/reset-password/check — before the form: is the link still good, and is it a reset or a first password
export async function checkLink(token) {
  const row = await usableToken(token);
  if (!row) throw LINK_INVALID();
  const user = await User.findOne({ _id: row.userId, status: 'active' }).select('name').lean();
  if (!user) throw LINK_INVALID();
  return { purpose: row.purpose, name: user.name };
}

// POST /api/auth/reset-password — sets the password and uses the link up (once, even if pressed twice)
export async function resetWithLink(token, password) {
  const problem = passwordProblem(password);
  if (problem) throw new AppError(400, 'VALIDATION_ERROR', problem, [{ field: 'body.password', message: problem }]);
  const row = await usableToken(token);
  if (!row) throw LINK_INVALID();
  const passwordHash = await hashPassword(password);

  await mongoose.connection.transaction(async (session) => {
    const now = new Date();
    const used = await PasswordToken.updateOne({ _id: row._id, usedAt: null, cancelledAt: null, expiresAt: { $gt: now } }, { $set: { usedAt: now } }, { session });
    if (used.modifiedCount !== 1) throw LINK_INVALID();
    const changed = await User.updateOne({ _id: row.userId, orgId: row.orgId, status: 'active' }, { $set: { passwordHash, passwordChangedAt: now } }, { session });
    if (changed.modifiedCount !== 1) throw LINK_INVALID();
  });
  return { message: 'Password changed. Please log in.' };
}

// Once a password email is done with, its stored copy loses the link (only the hash in PasswordToken stays)
onResult('PASSWORD', async (row) => {
  const removed = 'Removed: this email contained a one-time password link.';
  await EmailOutbox.updateOne({ _id: row._id }, { $set: { html: removed, text: removed } });
});
