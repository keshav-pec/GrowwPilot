// Cost fields are removed for people who may not see costs (inventory logins, front desk, and branch owners
// when the business owner has turned that off). The server does this, so hidden costs never reach the browser.
const COST_FIELDS = ['avgCost', 'unitCost', 'value', 'stockValue'];

export function withoutCosts(row, canSeeCosts) {
  if (canSeeCosts || !row) return row;
  const copy = { ...row };
  for (const field of COST_FIELDS) delete copy[field];
  return copy;
}
