import { isMeasured } from '../../config/inventory.js';

// Words for quantities, used in activity log lines and messages.
// Measured products are stored in base units: 3400 ml of a 1000 ml bottle -> "3 bottles + 400 ml".

function plural(unit, n) {
  if (n === 1 || ['ml', 'g'].includes(unit) || unit.endsWith('s')) return unit;
  return `${unit}s`;
}

// 10 -> "10 bottles"
export function describeUnits(n, unit) {
  return `${n} ${plural(unit, n)}`;
}

export function describeQty(qty, sku) {
  if (!isMeasured(sku)) return describeUnits(qty, sku.stockUnit);
  const per = sku.unitsPerStockUnit;
  const whole = Math.floor(qty / per);
  const rest = qty % per;
  if (whole === 0) return describeUnits(rest, sku.baseUnit);
  if (rest === 0) return describeUnits(whole, sku.stockUnit);
  return `${describeUnits(whole, sku.stockUnit)} + ${describeUnits(rest, sku.baseUnit)}`;
}

// The unit balances are counted in: "ml" for measured products, otherwise the stock unit
export const countingUnit = (sku) => (isMeasured(sku) ? sku.baseUnit : sku.stockUnit);
