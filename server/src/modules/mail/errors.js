// Why an email couldn't be sent, sorted into a few kinds. The kind decides what happens next:
//   QUOTA        Gmail's daily limit -> try the other route; else wait an hour
//   SCRIPT_DOWN  script URL dead (404, unpublished, an HTML page) -> try SMTP; else retry later
//   TIMEOUT, NETWORK, BUSY (429/503)  -> retry later (1, 5, 15, 60 minutes)
//   BAD_ADDRESS  -> failed straight away (sending again won't help)
//   UNAUTHORISED, SMTP_LOGIN, NOT_SET_UP, OTHER  -> failed straight away (a setup problem or something unknown)
export class MailError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind;
  }
}

export const RETRY_KINDS = ['TIMEOUT', 'NETWORK', 'BUSY', 'SCRIPT_DOWN'];

// What the owner reads on the Email card and in the outbox
export const PLAIN_REASON = {
  QUOTA: 'Gmail’s daily sending limit was reached. Emails will go out again in about an hour.',
  SCRIPT_DOWN: 'The Google mail script can’t be reached. Check it is deployed (access: Anyone) and MAIL_SCRIPT is its /exec link.',
  UNAUTHORISED: 'The mail script refused the secret. MAIL_SCRIPT_SECRET must match MAIL_SECRET in the script’s properties.',
  SMTP_LOGIN: 'Gmail refused the login. Check EMAIL_USER and EMAIL_PASS (a Gmail app password).',
  BAD_ADDRESS: 'The email address isn’t valid.',
  TIMEOUT: 'The mail service took too long to answer. It will be tried again.',
  NETWORK: 'Couldn’t reach the mail service. It will be tried again.',
  BUSY: 'The mail service is busy. It will be tried again.',
  NOT_SET_UP: 'Email is not set up on the server.',
  OTHER: 'The email couldn’t be sent.',
};

// "Service invoked too many times for one day: email" (Apps Script), "Daily user sending quota exceeded" (SMTP)
export function isQuotaError(err) {
  if (err?.kind === 'QUOTA') return true;
  const text = String(err?.message ?? err ?? '').toLowerCase();
  return text.includes('too many times') || (text.includes('quota') && text.includes('mail')) || text.includes('sending quota');
}

// The script URL is missing, gone or unpublished
export function isScriptDown(err) {
  return err?.kind === 'SCRIPT_DOWN';
}

// A message from the script (GmailApp) or Gmail, turned into one of the kinds above
export function classifyMessage(message) {
  const text = String(message ?? '');
  if (isQuotaError(text)) return new MailError('QUOTA', text);
  if (/unauthori[sz]ed/i.test(text)) return new MailError('UNAUTHORISED', text);
  if (/invalid (email|argument|recipient|address)|no recipient|recipient address rejected|address.*(invalid|not valid)/i.test(text)) {
    return new MailError('BAD_ADDRESS', text);
  }
  if (/script function not found|no longer available|unpublished/i.test(text)) return new MailError('SCRIPT_DOWN', text);
  if (/timed? ?out/i.test(text)) return new MailError('TIMEOUT', text);
  return new MailError('OTHER', text);
}

export function asMailError(err) {
  return err instanceof MailError ? err : classifyMessage(err?.message ?? err);
}

// Shortened for storing (a Gmail reply can be long)
export function errorText(err) {
  return String(err?.message ?? err).slice(0, 500);
}
