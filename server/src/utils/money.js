// Money is stored as whole paise (integers) to avoid rounding errors.
// ₹1,530.50 is saved as 153050.

// 1530.5 -> 153050
export function toPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

// 153050 -> 1530.5
export function toRupees(paise) {
  return paise / 100;
}

// 153050 -> "₹1,530.50" (used in the PDF export)
export function formatMoney(paise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(paise / 100);
}

// 2000000 -> "₹20,000", 2000050 -> "₹20,000.50" (no ".00" in plain-language messages)
export function formatAmount(paise) {
  const digits = paise % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format(paise / 100);
}
