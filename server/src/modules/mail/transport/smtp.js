import nodemailer from 'nodemailer';
import { MailError, classifyMessage } from '../errors.js';

// Gmail SMTP backup: one pooled connection set, made on first use.
// Short connect timeout: on hosts that block SMTP ports (Render free) it must fail fast, not hang the mailer.
let transport = null;

function getTransport(smtp) {
  if (!transport) {
    transport = nodemailer.createTransport({
      host: smtp.host,
      port: smtp.port,
      secure: smtp.port === 465, // 465 = TLS from the start; 587 = upgraded with STARTTLS
      auth: { user: smtp.user, pass: smtp.pass },
      pool: true,
      maxConnections: 3,
      maxMessages: 100,
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 30_000,
    });
  }
  return transport;
}

// Tests: forget the transport (so a new fake is picked up)
export function resetSmtp() {
  transport?.close?.();
  transport = null;
}

export async function sendSmtp(email, smtp) {
  try {
    await getTransport(smtp).sendMail({
      from: { name: email.fromName, address: smtp.user }, // always our own Gmail address; replies go to replyTo
      to: email.to,
      replyTo: email.replyTo || undefined,
      subject: email.subject,
      text: email.textBody,
      html: email.htmlBody,
      headers: email.headers,
      attachments: (email.attachments ?? []).map((a) => ({ filename: a.fileName, content: a.content, contentType: a.mimeType })),
    });
  } catch (err) {
    throw smtpError(err);
  }
}

function smtpError(err) {
  const code = err.responseCode;
  if (err.code === 'EAUTH' || code === 535 || code === 534) return new MailError('SMTP_LOGIN', err.message);
  if (err.code === 'EENVELOPE' || code === 553 || code === 501) return new MailError('BAD_ADDRESS', err.message);
  if (err.code === 'ETIMEDOUT' || err.code === 'ECONNECTION' || err.code === 'ESOCKET' || err.code === 'EDNS') {
    return new MailError(err.code === 'ETIMEDOUT' ? 'TIMEOUT' : 'NETWORK', err.message);
  }
  if (code === 421 || code === 450 || code === 451 || code === 452) return new MailError('BUSY', err.message);
  return classifyMessage(err.message); // e.g. 550 "Daily user sending quota exceeded" -> QUOTA
}
