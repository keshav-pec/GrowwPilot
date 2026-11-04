// "priya.sharma@gmail.com" -> "pr***@gmail.com": shown in lists and replies, never the whole address
export function maskEmail(email) {
  const [name, domain] = String(email ?? '').split('@');
  return domain ? `${name.slice(0, 2)}***@${domain}` : '';
}
