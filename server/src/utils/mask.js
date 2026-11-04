// "9876543210" -> "98******10": shown wherever the whole number shouldn't be (mark = 'X' on shared bills)
export function maskPhone(phone, mark = '*') {
  const text = String(phone ?? '');
  return text.length > 4 ? `${text.slice(0, 2)}${mark.repeat(text.length - 4)}${text.slice(-2)}` : text;
}

// "priya.sharma@gmail.com" -> "pr***@gmail.com": shown in lists and replies, never the whole address
export function maskEmail(email) {
  const [name, domain] = String(email ?? '').split('@');
  return domain ? `${name.slice(0, 2)}***@${domain}` : '';
}
