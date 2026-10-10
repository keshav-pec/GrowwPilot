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

// 2000000 -> "₹20,000", 2000050 -> "₹20,000.50" (no ".00" in sentences)
export function formatAmount(paise) {
  const digits = (paise || 0) % 100 === 0 ? 0 : 2;
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: digits, maximumFractionDigits: digits }).format((paise || 0) / 100);
}
