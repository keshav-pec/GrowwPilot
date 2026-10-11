// The commission maths. Pure functions, so they are easy to test and explain.

// Shares a bill's total across its services in proportion to their normal prices, in whole paise.
// The shares always add up to the total exactly (leftover paise go to the biggest remainders).
//   splitByPrice([250000], 230000)          -> [230000]   (₹2,500 service, ₹200 discount)
//   splitByPrice([50000, 20000], 60000)     -> [42857, 17143]   (₹600 combo of a ₹500 and a ₹200 service)
export function splitByPrice(prices, total) {
  const sum = prices.reduce((a, b) => a + b, 0);
  if (sum === 0) return prices.map((_, i) => (i === 0 ? total : 0));

  const exact = prices.map((p) => (p * total) / sum);
  const shares = exact.map(Math.floor);
  let left = total - shares.reduce((a, b) => a + b, 0);
  const byRemainder = exact.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (const [, i] of byRemainder) {
    if (left === 0) break;
    shares[i] += 1;
    left -= 1;
  }
  return shares;
}

// ₹2,300 at 10% (1000 basis points) -> ₹230, rounded to the nearest paisa
export function commissionAmount(saleAmount, rateBps) {
  return Math.round((saleAmount * rateBps) / 10000);
}

// Which rate applies, in order: a special rate for this service -> the person's normal % from their pay setup.
// No commission at all if their pay setup on that day doesn't include commission.
export function pickRate(plan, rule) {
  if (!plan?.commissionBps) return null;
  if (rule) return { rateBps: rule.rateBps, rateSource: 'service_rate', ruleId: rule._id };
  return { rateBps: plan.commissionBps, rateSource: 'pay_setup', ruleId: plan._id };
}
