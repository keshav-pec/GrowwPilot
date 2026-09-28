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
