// Money is stored as whole paise on the server (₹1,530.50 = 153050).

// 153050 -> "₹1,530.50"
export function formatMoney(paise) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format((paise || 0) / 100);
}

// 1530.5 -> 153050
export function toPaise(rupees) {
  return Math.round(Number(rupees) * 100);
}
