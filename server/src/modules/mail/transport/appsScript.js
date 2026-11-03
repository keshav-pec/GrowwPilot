import { MailError, classifyMessage } from '../errors.js';

// Sends to the Google Apps Script web app (server/mail-script/Code.gs). The reply rules:
// - Google redirects /exec once, so redirects are followed
// - an HTML page (404, "script not found", Google login) = the script is down
// - an empty or non-JSON reply = sent (Apps Script sometimes answers with nothing useful)
// - only { status: "error" } is a failure; its message says why
export async function callScript(url, payload, { timeoutMs }) {
  if (!url) throw new MailError('SCRIPT_DOWN', 'MAIL_SCRIPT is not set');

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    if (err.name === 'TimeoutError' || err.name === 'AbortError') throw new MailError('TIMEOUT', `Mail script did not answer within ${timeoutMs / 1000} s`);
    throw new MailError('NETWORK', `Mail script unreachable: ${err.cause?.code ?? err.message}`);
  }

  const text = await res.text().catch(() => '');
  if (res.status === 429 || res.status === 503) throw new MailError('BUSY', `Mail script answered ${res.status}`);
  if (looksLikeHtml(text) || res.status === 404) throw new MailError('SCRIPT_DOWN', `Mail script answered ${res.status} with a web page, not JSON`);
  if (res.status >= 500) throw new MailError('BUSY', `Mail script answered ${res.status}`);
  if (!res.ok) throw new MailError('SCRIPT_DOWN', `Mail script answered ${res.status}`);

  if (!text.trim()) return { status: 'success' };
  let reply;
  try {
    reply = JSON.parse(text);
  } catch {
    return { status: 'success' };
  }
  if (reply?.status === 'error') throw classifyMessage(reply.message);
  return reply ?? { status: 'success' };
}

function looksLikeHtml(text) {
  return /^\s*<(!doctype html|html|head|body)/i.test(text);
}

// The script's health check (doGet). Never throws.
export async function pingScript(url, { timeoutMs = 5000 } = {}) {
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text();
    if (!res.ok || looksLikeHtml(text)) return { reachable: false, message: `Answered ${res.status} with a web page, not JSON` };
    const reply = JSON.parse(text);
    return reply?.status === 'ok' ? { reachable: true } : { reachable: false, message: 'Unexpected answer from the script' };
  } catch (err) {
    return { reachable: false, message: err.name === 'TimeoutError' ? 'No answer within 5 s' : 'Couldn’t reach the script' };
  }
}
