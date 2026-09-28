// Indian mobile numbers are saved as plain 10 digits, so "+91 98765 43210",
// "098765-43210" and "9876543210" are all treated as the same number.
export function normalizePhone(input) {
  if (input == null) return input;

  let digits = String(input).replace(/\D/g, ''); // keep digits only

  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2); // remove +91
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1); // remove leading 0

  return digits;
}

// A valid Indian mobile number: 10 digits starting with 6, 7, 8 or 9
export const PHONE_REGEX = /^[6-9]\d{9}$/;
