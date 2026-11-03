import { env } from '../../config/env.js';

// Email settings, read once from the environment (see config/env.js and EMAIL_PLAN.md section C).
// Kept in one object so tests can switch routes on and off with configureMail().
const settings = fromEnv();

function fromEnv() {
  return {
    scriptUrl: env.MAIL_SCRIPT ?? null,
    scriptSecret: env.MAIL_SCRIPT_SECRET ?? null,
    passwordScriptUrl: env.MAIL_FORGOT_PASSWORD ?? null,
    timeoutMs: env.MAIL_SCRIPT_TIMEOUT_MS,
    smtp: { host: env.EMAIL_HOST, port: env.EMAIL_PORT, user: env.EMAIL_USER ?? null, pass: env.EMAIL_PASS ?? null },
    dailyLimit: env.MAIL_DAILY_LIMIT,
  };
}

export function mailSettings() {
  return settings;
}

// Tests only: change some settings (configureMail({ scriptUrl: null }) turns the script off); reset with no argument
export function configureMail(changes) {
  Object.assign(settings, changes ?? fromEnv());
}

export function scriptConfigured() {
  return Boolean(settings.scriptUrl && settings.scriptSecret);
}

export function smtpConfigured() {
  return Boolean(settings.smtp.user && settings.smtp.pass);
}

// At least one real way to send
export function mailConfigured() {
  return scriptConfigured() || smtpConfigured();
}

// Password emails can use their own script (a second Gmail account has its own daily limit)
export function scriptUrlFor(kind) {
  return (kind === 'PASSWORD' && settings.passwordScriptUrl) || settings.scriptUrl;
}

// live = really sends; log = development/tests: printed (development) and kept in memory, marked "Logged";
// off = production with nothing set up: nothing can be sent
export function mailMode() {
  if (mailConfigured()) return 'live';
  return env.NODE_ENV === 'production' ? 'off' : 'log';
}
