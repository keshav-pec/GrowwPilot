import { EmailOutbox } from '../../models/index.js';
import { scoped } from '../../utils/scoped.js';
import { mailSettings, scriptUrlFor } from './config.js';
import { MailError, PLAIN_REASON, RETRY_KINDS, asMailError, errorText } from './errors.js';
import { cleanSubject } from './html.js';
import { BATCH_SIZE, sendBatch, sendOne } from './transport/send.js';

// ---------------------------------------------------------------------------
// Email outbox (same idea as inventory/automation/outbox.js):
// 1. queueEmail() writes one row inside the caller's transaction, so the email exists only if the change does.
// 2. kickMailer() after the commit sends it in the background; the front desk never waits.
// 3. A sweep every minute picks up retries and rows cut off by a restart.
// Rows are claimed one at a time with an atomic update, so two servers never send the same row.
// ---------------------------------------------------------------------------

const MAX_ATTEMPTS = 5;
const RETRY_WAIT_MINUTES = [1, 5, 15, 60]; // after attempt 1, 2, 3, 4
const QUOTA_WAIT_MS = 60 * 60 * 1000;
const LOCK_MS = 5 * 60 * 1000; // a SENDING row older than this was cut off: send it again
const SWEEP_EVERY_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const URGENT = 2; // at the daily limit only priority 1–2 (password, test) still go out
export const DEFAULT_PRIORITY = { PASSWORD: 1, TEST: 2, BILL: 3, OCCASION_OFFER: 4 }; // 5 = automatic offers

// Hooks other parts register by kind (Part 2: offers; Part 5: bill PDFs)
const beforeSendChecks = new Map(); // kind -> async (row) => ({ skip: true, reason }) or nothing
const resultHooks = new Map(); // kind -> async (row) after SENT / FAILED / SKIPPED
const attachmentBuilders = new Map(); // attachment type -> async (row) => { fileName, mimeType, content: Buffer }
export const onBeforeSend = (kind, check) => beforeSendChecks.set(kind, check);
export const onResult = (kind, hook) => resultHooks.set(kind, hook);
export const onAttachment = (type, build) => attachmentBuilders.set(type, build);

// email: { dedupeKey, kind, to, subject, html, text, fromName, replyTo?, branchId?, priority?, headers?, attachment?, ref? }
// Queueing the same dedupeKey again does nothing. Call kickMailer() once the transaction has committed.
export async function queueEmail(ctx, email, session) {
  const doc = new EmailOutbox({
    orgId: ctx.orgId,
    branchId: email.branchId,
    kind: email.kind,
    priority: email.priority ?? DEFAULT_PRIORITY[email.kind],
    to: email.to,
    subject: cleanSubject(email.subject),
    html: email.html,
    text: email.text,
    fromName: cleanSubject(email.fromName),
    replyTo: email.replyTo || undefined,
    headers: email.headers,
    attachment: email.attachment,
    ref: email.ref,
    dedupeKey: email.dedupeKey,
    createdBy: { id: ctx.userId, name: ctx.userName },
  });
  await doc.validate();
  const { _id, ...fields } = doc.toObject();
  const row = await EmailOutbox.findOneAndUpdate(
    scoped(ctx, { dedupeKey: email.dedupeKey }),
    { $setOnInsert: fields },
    { upsert: true, returnDocument: 'after', session, lean: true }
  );
  return { id: row._id, status: row.status };
}

// --- The mailer ---

let running = false;
let runAgain = false;
let pausedUntil = 0; // Gmail's quota was hit with no backup: nothing goes out until then

export function kickMailer() {
  setImmediate(runMailer);
}

async function runMailer() {
  if (running) {
    runAgain = true; // finish this round, then go again for what was just queued
    return;
  }
  running = true;
  try {
    do {
      runAgain = false;
      await processOutbox();
    } while (runAgain);
  } catch (err) {
    console.error('Email outbox:', err);
  } finally {
    running = false;
  }
}

export function mailerPausedUntil() {
  return pausedUntil > Date.now() ? new Date(pausedUntil) : null;
}

// Tests: forget a quota pause
export function resetMailer() {
  pausedUntil = 0;
}

// Emails really sent (not just logged) by the whole platform in the last 24 hours
export function sentLast24h(extra = {}) {
  return EmailOutbox.countDocuments({ ...extra, status: 'SENT', via: { $in: ['APPS_SCRIPT', 'SMTP'] }, sentAt: { $gte: new Date(Date.now() - DAY_MS) } });
}

// Sends everything that is due. Returns how many rows were handled. Safe to run on several servers at once.
export async function processOutbox() {
  let handled = 0;
  while (Date.now() >= pausedUntil) {
    const room = mailSettings().dailyLimit - (await sentLast24h());
    const maxPriority = room > 0 ? 5 : URGENT;

    // Emails without an attachment go together, up to 40 in one call to the script
    const batch = await claimSome({ attachment: null }, maxPriority, room > 0 ? Math.min(BATCH_SIZE, room) : BATCH_SIZE);
    if (batch.length > 0) {
      await sendRows(batch);
      handled += batch.length;
      continue;
    }
    // Emails with an attachment (a bill PDF) go one at a time
    const single = await claimOne({ attachment: { $ne: null } }, maxPriority);
    if (!single) break;
    await sendRows([single]);
    handled += 1;
  }
  return handled;
}

function claimOne(filter, maxPriority) {
  const now = new Date();
  return EmailOutbox.findOneAndUpdate(
    {
      ...filter,
      priority: { $lte: maxPriority },
      $or: [
        { status: 'PENDING', nextAttemptAt: { $lte: now } },
        { status: 'SENDING', lockedUntil: { $lt: now } },
      ],
    },
    { $set: { status: 'SENDING', lockedUntil: new Date(now.getTime() + LOCK_MS) }, $inc: { attempts: 1 } },
    { sort: { priority: 1, nextAttemptAt: 1 }, returnDocument: 'after', lean: true }
  );
}

async function claimSome(filter, maxPriority, count) {
  const rows = [];
  while (rows.length < count) {
    const row = await claimOne(filter, maxPriority);
    if (!row) break;
    rows.push(row);
  }
  return rows;
}

async function sendRows(rows) {
  const ready = [];
  for (const row of rows) {
    const check = beforeSendChecks.get(row.kind);
    try {
      const verdict = check && (await check(row));
      if (verdict?.skip) await finish(row, { status: 'SKIPPED', lastError: verdict.reason });
      else ready.push({ row, email: await outgoing(row) });
    } catch (err) {
      await settleRow(row, { error: err instanceof MailError ? err : new MailError('BUSY', `Couldn’t prepare the email: ${err.message}`) });
    }
  }
  if (ready.length === 0) return;

  if (ready.length === 1 && ready[0].email.attachments) {
    const [{ row, email }] = ready;
    return settleRow(row, await sendOne(email).catch((err) => ({ error: asMailError(err) })));
  }
  // Password emails may use their own script, so each script gets its own batch
  const byScript = new Map();
  for (const item of ready) {
    const url = scriptUrlFor(item.row.kind);
    byScript.set(url, [...(byScript.get(url) ?? []), item]);
  }
  for (const group of byScript.values()) {
    const results = await sendBatch(group.map((g) => g.email));
    await Promise.all(group.map(({ row }, i) => settleRow(row, results[i])));
  }
}

async function outgoing(row) {
  const email = { kind: row.kind, to: row.to, subject: row.subject, htmlBody: row.html, textBody: row.text, fromName: row.fromName, replyTo: row.replyTo, headers: row.headers };
  if (row.attachment) {
    const build = attachmentBuilders.get(row.attachment.type);
    if (!build) throw new MailError('OTHER', `No way to build a ${row.attachment.type} attachment`);
    email.attachments = [await build(row)];
  }
  return email;
}

async function settleRow(row, result) {
  if (result.via) {
    return finish(row, { status: 'SENT', via: result.via, sentAt: new Date(), lastError: null, errorKind: null, errorDetail: null });
  }
  const err = result.error;
  const problem = { lastError: PLAIN_REASON[err.kind] ?? PLAIN_REASON.OTHER, errorKind: err.kind, errorDetail: errorText(err) };

  if (err.kind === 'QUOTA') {
    // Not this email's fault: it waits for the quota (without using up a try), and the mailer pauses
    pausedUntil = Date.now() + QUOTA_WAIT_MS;
    return EmailOutbox.updateOne(
      { _id: row._id, status: 'SENDING' },
      { $set: { ...problem, status: 'PENDING', nextAttemptAt: new Date(pausedUntil), lockedUntil: null }, $inc: { attempts: -1 } }
    );
  }
  if (RETRY_KINDS.includes(err.kind) && row.attempts < MAX_ATTEMPTS) {
    const wait = RETRY_WAIT_MINUTES[row.attempts - 1] * 60 * 1000;
    return EmailOutbox.updateOne(
      { _id: row._id, status: 'SENDING' },
      { $set: { ...problem, status: 'PENDING', nextAttemptAt: new Date(Date.now() + wait), lockedUntil: null } }
    );
  }
  return finish(row, { ...problem, status: 'FAILED' });
}

// The row's final state, then the hook for its kind (once: only if this run still held the row)
async function finish(row, fields) {
  const result = await EmailOutbox.updateOne({ _id: row._id, status: 'SENDING' }, { $set: { ...fields, lockedUntil: null } });
  if (result.modifiedCount === 0) return;
  const hook = resultHooks.get(row.kind);
  if (!hook) return;
  try {
    await hook({ ...row, ...fields });
  } catch (err) {
    console.error(`Email outbox: after-send step for ${row.kind} failed:`, err);
  }
}

// Started once when the server starts: send what is waiting, then sweep every minute
export function startMailer() {
  kickMailer();
  setInterval(runMailer, SWEEP_EVERY_MS).unref();
}
