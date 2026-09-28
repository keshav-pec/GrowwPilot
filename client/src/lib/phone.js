// Same rules as the server's utils/phone.js, so the form can show errors before sending.

// "+91 98765 43210" -> "9876543210"
export function normalizePhone(input) {
  let digits = String(input ?? '').replace(/\D/g, '');
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1);
  return digits;
}

export function isValidPhone(input) {
  return /^[6-9]\d{9}$/.test(normalizePhone(input));
}
