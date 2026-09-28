// Money is stored as whole paise on the server (₹1,530.50 = 153050).

// 153050 -> "₹1,530.50"
export function formatMoney(paise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100);
}

// 1530.5 -> 153050
export function toPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}

// Checks what the user typed in a ₹ field: "500", "499.5" or "499.50"
export function isValidRupees(text) {
  return /^\d+(\.\d{1,2})?$/.test(String(text).trim());
}
