import { DateTime } from 'luxon';
import { Branch, EmailOutbox, Organization } from '../../models/index.js';
import { maskEmail } from '../../utils/mask.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { runOnce } from '../../middleware/idempotency.js';
import { mailMode, mailSettings, scriptConfigured, smtpConfigured } from './config.js';
import { escapeHtml, layout, textToHtml } from './html.js';
import { kickMailer, mailerPausedUntil, queueEmail, sentLast24h } from './outbox.js';
import { pingScript } from './transport/appsScript.js';

const DAY_MS = 24 * 60 * 60 * 1000;

// The script's health check, remembered for a minute (the Email card may be opened often)
let lastPing = null;
async function scriptHealth() {
  if (!scriptConfigured()) return null;
  if (lastPing && Date.now() - lastPing.at < 60_000) return lastPing.result;
  const result = await pingScript(mailSettings().scriptUrl);
  lastPing = { at: Date.now(), result };
  return result;
}

// The Email card: is email on, which routes, is the script answering, how much of the daily limit is used
export async function mailStatus(ctx, user) {
  const since = (ms) => new Date(Date.now() - ms);
  const [script, platformSent, salonSent, salonFailed, salonWaiting] = await Promise.all([
    scriptHealth(),
    sentLast24h(),
    sentLast24h(scoped(ctx)),
    EmailOutbox.countDocuments(scoped(ctx, { status: 'FAILED', updatedAt: { $gte: since(7 * DAY_MS) } })),
    EmailOutbox.countDocuments(scoped(ctx, { status: { $in: ['PENDING', 'SENDING'] } })),
  ]);
  const mode = mailMode();
  return {
    mode, // live | log (development: printed, not sent) | off
    setUp: mode === 'live',
    routes: { appsScript: scriptConfigured(), smtp: smtpConfigured(), separatePasswordScript: Boolean(mailSettings().passwordScriptUrl) },
    script,
    dailyLimit: mailSettings().dailyLimit,
    sentLast24h: platformSent, // the limit is shared by every salon on the app
    salon: { sentLast24h: salonSent, failedLast7Days: salonFailed, waiting: salonWaiting },
    pausedUntil: mailerPausedUntil(),
    testTo: user.email,
  };
}

// Who an email is from: the salon's name, and replies go to the salon's contact email (not to our Gmail account)
async function salonSender(ctx, session = null) {
  const org = await Organization.findById(ctx.orgId).select('name contactEmail').session(session).lean();
  return { name: org.name, fromName: org.name, replyTo: org.contactEmail };
}

// A test email to the business owner's own login email
export async function sendTestEmail(ctx, { user, key }) {
  if (mailMode() === 'off') throw new AppError(409, 'MAIL_OFF', 'Email is off on the server.');
  const org = await salonSender(ctx);
  const sentOn = new Date().toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Kolkata' });
  const text = `Hello ${user.name},\n\nThis is a test email from ${org.name} on GrowwPilot.\nIf you can read this, email is working.\n\nSent on ${sentOn}.`;
  const result = await runOnce(ctx, { key, operation: 'mail.test' }, async (session) => {
    const queued = await queueEmail(
      ctx,
      {
        kind: 'TEST',
        dedupeKey: `test:${key}`,
        to: user.email,
        subject: `Test email from ${org.name}`,
        text,
        html: layout({ salonName: org.name, body: textToHtml(text), footer: `Sent by GrowwPilot for ${escapeHtml(org.name)}.` }),
        fromName: org.fromName,
        replyTo: org.replyTo,
        ref: { userId: user._id },
      },
      session
    );
    return { id: queued.id, to: user.email };
  });
  kickMailer();
  return result;
}

// How the test email is doing (the card asks every few seconds until it is Sent or Failed)
export async function testEmailState(ctx, id) {
  const row = await EmailOutbox.findOne(scoped(ctx, { _id: id, kind: 'TEST' })).select('status via sentAt lastError to').lean();
  if (!row) throw new AppError(404, 'NOT_FOUND', 'Test email not found');
  return { id: row._id, to: row.to, status: row.status, via: row.via ?? null, sentAt: row.sentAt ?? null, error: row.lastError ?? null };
}

// GET /api/mail/log — the salon's recent emails, newest first. No email body, the address partly hidden.
// Business owner: every email; branch owner: emails of their branches (test and password emails have no branch).
const LOG_PAGE = 25;
const KIND_LABEL = { TEST: 'Test email', OCCASION_OFFER: 'Occasion offer', PASSWORD: 'Password link', BILL: 'Bill' };
export async function mailLog(ctx, { kind, status, from, to, page }) {
  const filter = ctx.isPrimaryOwner ? scoped(ctx) : scoped(ctx, { branchId: { $in: ctx.allowedBranchIds } });
  if (kind) filter.kind = kind;
  if (status) filter.status = status === 'WAITING' ? { $in: ['PENDING', 'SENDING'] } : status;
  if (from || to) {
    const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).select('timezone').lean();
    const zone = branch?.timezone ?? 'Asia/Kolkata';
    filter.createdAt = {};
    if (from) filter.createdAt.$gte = DateTime.fromISO(from, { zone }).startOf('day').toJSDate();
    if (to) filter.createdAt.$lte = DateTime.fromISO(to, { zone }).endOf('day').toJSDate();
  }
  const [rows, total, branches] = await Promise.all([
    EmailOutbox.find(filter)
      .select('kind to subject status via attempts lastError branchId createdAt sentAt createdBy priority')
      .sort({ createdAt: -1, _id: -1 })
      .skip((page - 1) * LOG_PAGE)
      .limit(LOG_PAGE)
      .lean(),
    EmailOutbox.countDocuments(filter),
    Branch.find(scoped(ctx)).select('name').lean(),
  ]);
  const branchName = new Map(branches.map((b) => [String(b._id), b.name]));
  return {
    emails: rows.map((r) => ({
      _id: r._id,
      kind: r.kind,
      kindLabel: KIND_LABEL[r.kind],
      automatic: r.kind === 'OCCASION_OFFER' && r.priority === 5,
      to: maskEmail(r.to),
      subject: r.kind === 'PASSWORD' ? 'Password link' : r.subject,
      status: r.status,
      via: r.via ?? null,
      attempts: r.attempts,
      error: r.lastError ?? null,
      branchName: r.branchId ? (branchName.get(String(r.branchId)) ?? null) : null,
      by: r.createdBy?.name ?? null,
      createdAt: r.createdAt,
      sentAt: r.sentAt ?? null,
    })),
    total,
    page,
    pageSize: LOG_PAGE,
  };
}
