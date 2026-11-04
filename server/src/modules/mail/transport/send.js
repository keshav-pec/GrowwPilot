import { env } from '../../../config/env.js';
import { mailMode, mailSettings, scriptConfigured, scriptUrlFor, smtpConfigured } from '../config.js';
import { MailError, asMailError, isQuotaError, isScriptDown } from '../errors.js';
import { callScript } from './appsScript.js';
import { sendSmtp } from './smtp.js';

export { isQuotaError, isScriptDown } from '../errors.js';
export { mailConfigured, smtpConfigured } from '../config.js';

// The only place that sends email. Nothing else calls the script or nodemailer.
//
// An email: { kind, to, subject, htmlBody, textBody, fromName, replyTo, headers?, attachments?: [{ fileName, mimeType, content: Buffer }] }
// Order:  no attachment -> Apps Script, then SMTP if the script hit its quota or is down
//         attachment    -> SMTP first (the script is slow with big bodies), then Apps Script
// Returns { via: 'APPS_SCRIPT' | 'SMTP' | 'LOG' } or throws a MailError.

export const BATCH_SIZE = 40; // most emails in one call to the script

// Development and tests with no email settings: emails are kept here (and printed in development)
const logged = [];
export function loggedEmails() {
  return logged;
}

function logEmail(email) {
  logged.push(email);
  if (logged.length > 200) logged.shift();
  if (env.NODE_ENV === 'development') {
    console.log(`\n[email, not sent: email is off] to ${email.to}\nSubject: ${email.subject}\n${email.textBody}\n`);
  }
  return { via: 'LOG' };
}

let toldBackup = false;
function noteBackup(reason) {
  if (toldBackup) return;
  toldBackup = true;
  console.warn(`Email: using SMTP backup (${reason})`);
}

// The script's quota or a dead script are the only reasons to switch from the script to SMTP
const scriptFallsBack = (err) => smtpConfigured() && (isQuotaError(err) || isScriptDown(err));
// From SMTP to the script: anything but a bad address (SMTP blocked, login refused, Gmail limit...)
const smtpFallsBack = (err) => scriptConfigured() && err.kind !== 'BAD_ADDRESS';

export async function sendOne(email) {
  const mode = mailMode();
  if (mode === 'log') return logEmail(email);
  if (mode === 'off') throw new MailError('MAIL_OFF', 'Email is off');

  const viaScript = () => sendScriptOne(email);
  const viaSmtp = () => sendSmtp(email, mailSettings().smtp).then(() => ({ via: 'SMTP' }));
  const hasAttachment = email.attachments?.length > 0;

  if (hasAttachment && smtpConfigured()) {
    try {
      return await viaSmtp();
    } catch (err) {
      if (!smtpFallsBack(err)) throw err;
      return viaScript();
    }
  }
  if (!scriptConfigured()) return viaSmtp();
  try {
    return await viaScript();
  } catch (err) {
    if (!scriptFallsBack(err)) throw err;
    noteBackup(err.kind === 'QUOTA' ? 'Gmail script quota reached' : 'mail script down');
    return viaSmtp();
  }
}

async function sendScriptOne(email) {
  const { scriptSecret, timeoutMs } = mailSettings();
  await callScript(scriptUrlFor(email.kind), { secret: scriptSecret, ...forScript(email) }, { timeoutMs });
  return { via: 'APPS_SCRIPT' };
}

// Several emails (no attachments). Returns one result per email, in order: { via } or { error: MailError }.
export async function sendBatch(emails) {
  const results = [];
  for (let start = 0; start < emails.length; start += BATCH_SIZE) {
    results.push(...(await sendChunk(emails.slice(start, start + BATCH_SIZE))));
  }
  return results;
}

async function sendChunk(emails) {
  const mode = mailMode();
  if (mode === 'log') return emails.map(logEmail);
  if (mode === 'off') return emails.map(() => ({ error: new MailError('MAIL_OFF', 'Email is off') }));
  if (!scriptConfigured()) return Promise.all(emails.map((email) => settle(sendOne(email))));

  const { scriptSecret, timeoutMs } = mailSettings();
  let reply;
  try {
    reply = await callScript(scriptUrlFor(emails[0].kind), { secret: scriptSecret, emails: emails.map(forScript) }, { timeoutMs });
  } catch (err) {
    // The whole call failed: on quota or a dead script, each one goes by SMTP; otherwise all share the error
    if (!scriptFallsBack(err)) return emails.map(() => ({ error: err }));
    noteBackup(err.kind === 'QUOTA' ? 'Gmail script quota reached' : 'mail script down');
    return Promise.all(emails.map((email) => settle(sendSmtp(email, mailSettings().smtp).then(() => ({ via: 'SMTP' })))));
  }

  // An empty or older-style reply without per-email results means all were sent
  const perEmail = Array.isArray(reply.results) ? reply.results : [];
  return Promise.all(
    emails.map(async (email, i) => {
      const result = perEmail[i];
      if (!result || result.status !== 'failed') return { via: 'APPS_SCRIPT' };
      // The script stops at the first "too many times"; the rest come back skipped
      const err = result.skipped ? new MailError('QUOTA', result.message || 'Skipped: daily quota reached') : asMailError(result.message);
      if (!scriptFallsBack(err)) return { error: err };
      noteBackup('Gmail script quota reached');
      return settle(sendSmtp(email, mailSettings().smtp).then(() => ({ via: 'SMTP' })));
    })
  );
}

const settle = (promise) => promise.catch((err) => ({ error: asMailError(err) }));

// What the script expects for one email (attachments as base64 text)
function forScript(email) {
  return {
    to: email.to,
    subject: email.subject,
    htmlBody: email.htmlBody,
    textBody: email.textBody,
    fromName: email.fromName,
    replyTo: email.replyTo || undefined,
    attachments: email.attachments?.map((a) => ({ fileName: a.fileName, mimeType: a.mimeType, base64: a.content.toString('base64') })),
  };
}
