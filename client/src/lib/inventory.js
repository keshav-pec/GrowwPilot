// Words and numbers for the Inventory screens.

// The four ways stock is used (see INVENTORY_PLAN.md)
export const WAYS_OF_USE = [
  { value: 'FINISH', label: 'Finish', hint: 'Whole bottles are handed out and used up when someone marks them finished. E.g. shampoo, wax jars.' },
  { value: 'SERVICE_UNITS', label: 'Per service, whole units', hint: 'A set number is used up each time the service is done. E.g. facial kits, disposable caps.' },
  { value: 'SERVICE_MEASURED', label: 'Per service, by measure', hint: 'A set amount of ml, g or pieces is used each time. E.g. hair colour, developer.' },
  { value: 'MANUAL', label: 'By hand', hint: 'Someone records use when it happens. For anything unplanned.' },
];
export const WAY_OF_USE_LABEL = Object.fromEntries(WAYS_OF_USE.map((w) => [w.value, w.label]));

export const SKU_TYPES = [
  { value: 'PROFESSIONAL', label: 'Professional (used in services)' },
  { value: 'RETAIL', label: 'Retail (for sale)' },
  { value: 'DISPOSABLE', label: 'Disposable' },
  { value: 'GENERAL_SUPPLY', label: 'General supply' },
  { value: 'REUSABLE_ASSET', label: 'Reusable item' },
];
export const SKU_TYPE_LABEL = Object.fromEntries(SKU_TYPES.map((t) => [t.value, t.label]));

// Suggestions for the stock unit box (any word is allowed)
export const STOCK_UNITS = ['bottle', 'jar', 'tube', 'kit', 'box', 'pack', 'piece', 'can', 'sachet', 'roll', 'pair'];

export const BASE_UNITS = [
  { value: 'ml', label: 'ml' },
  { value: 'g', label: 'g' },
  { value: 'piece', label: 'pieces' },
];

export const MOVEMENT_LABEL = {
  OPENING: 'Opening stock',
  RECEIPT: 'Received',
  ISSUE: 'Issued',
  RETURN: 'Returned to store',
  TRANSFER: 'Moved to someone else',
  FINISH: 'Finished',
  SERVICE_USE: 'Used in a service',
  WRITE_OFF: 'Written off',
  ADJUSTMENT: 'Count corrected',
  COUNT_CORRECTION: 'Stock count',
  CORRECTION: 'Correction',
  RETURN_TO_SUPPLIER: 'Returned to supplier',
};

// Why stock was used or written off by hand
export const WRITE_OFF_REASONS = [
  { value: 'DIRECT_USE', label: 'Used' },
  { value: 'DAMAGE', label: 'Damaged' },
  { value: 'EXPIRY', label: 'Expired' },
  { value: 'LOSS', label: 'Lost' },
  { value: 'SPILLAGE', label: 'Spilled' },
  { value: 'STOCK_COUNT_CORRECTION', label: 'Count was wrong' },
];
export const REASON_LABEL = { ...Object.fromEntries(WRITE_OFF_REASONS.map((r) => [r.value, r.label])), OTHER: 'Something else' };
// What the front desk can report
export const REPORT_REASONS = [...WRITE_OFF_REASONS.filter((r) => r.value !== 'DIRECT_USE'), { value: 'OTHER', label: 'Something else' }];

// "Written off: Damaged", "Finished"...
export function movementLabel(m) {
  if (m.type === 'WRITE_OFF') return m.reason === 'DIRECT_USE' ? 'Used by hand' : `Written off: ${REASON_LABEL[m.reason]}`;
  return MOVEMENT_LABEL[m.type];
}

export const isMeasured = (sku) => sku?.wayOfUse === 'SERVICE_MEASURED';

function plural(unit, n) {
  if (n === 1 || ['ml', 'g'].includes(unit) || unit.endsWith('s')) return unit;
  return `${unit}s`;
}

// 10 -> "10 bottles"
export function formatUnits(n, unit) {
  return `${n} ${plural(unit, n)}`;
}

// Stock is a whole number in the product's counting unit.
// Measured products are counted in their base unit: 3400 ml of 1000 ml bottles -> "3 bottles + 400 ml".
export function formatQty(qty, sku) {
  if (qty == null) return '—';
  const sign = qty < 0 ? '−' : '';
  const n = Math.abs(qty);
  if (!isMeasured(sku)) return sign + formatUnits(n, sku.stockUnit);
  const per = sku.unitsPerStockUnit;
  const whole = Math.floor(n / per);
  const rest = n % per;
  if (whole === 0) return sign + formatUnits(rest, sku.baseUnit);
  if (rest === 0) return sign + formatUnits(whole, sku.stockUnit);
  return `${sign}${formatUnits(whole, sku.stockUnit)} + ${formatUnits(rest, sku.baseUnit)}`;
}

// The server keeps the average cost per counting unit (per ml for measured products); people think per bottle
export const costPerStockUnit = (avgCost, sku) => (avgCost == null ? null : Math.round(avgCost * sku.unitsPerStockUnit));

// A random id made once per form, sent as the Idempotency-Key header: a double click or a retry
// then changes stock only once
export const newRequestKey = () => crypto.randomUUID();

// Recipients travel as { kind, id } and show up in pickers as "FLOOR", "STATION:<id>" or "STAFF:<id>"
export const recipientValue = (r) => (r.kind === 'FLOOR' ? 'FLOOR' : `${r.kind}:${r.id ?? r._id}`);
export function recipientFromValue(value) {
  const [kind, id] = value.split(':');
  return kind === 'FLOOR' ? { kind } : { kind, id };
}

// The store and recipient used last at this branch, so the next issue is quicker (kept in this browser only)
const lastKey = (branchId) => `gp_inventory_last:${branchId}`;
export function rememberedChoice(branchId) {
  try {
    return JSON.parse(localStorage.getItem(lastKey(branchId))) ?? {};
  } catch {
    return {};
  }
}
export function rememberChoice(branchId, choice) {
  try {
    localStorage.setItem(lastKey(branchId), JSON.stringify({ ...rememberedChoice(branchId), ...choice }));
  } catch {
    // private window: nothing is remembered
  }
}

// Why a completed service couldn't take its stock
export const EXCEPTION_REASON_LABEL = {
  NOT_ENOUGH_STOCK: 'Not enough stock',
  NOT_STOCKED_HERE: 'Not stocked at this branch',
  PRODUCT_INACTIVE: 'Product deactivated',
  NO_OPEN_HANDOUT: 'No open bottle',
};

// A recipe in a line: "1 kit Facial kit · 60 ml Developer · Shampoo (linked)"
export function describeRecipe(recipe) {
  if (!recipe || recipe.lines.length === 0) return 'Uses nothing';
  return recipe.lines.map((l) => (l.deducts ? `${formatQty(l.qty, l.sku)} ${l.sku.name}` : `${l.sku.name} (linked)`)).join(' · ');
}

// Purchase order statuses, in words
export const PO_STATUS = {
  DRAFT: ['Draft', 'neutral'],
  PENDING_APPROVAL: ['Waiting for approval', 'gold'],
  APPROVED: ['Approved', 'brown'],
  ORDERED: ['Ordered', 'brown'],
  PARTIALLY_RECEIVED: ['Part received', 'orange'],
  RECEIVED: ['Received', 'brown'],
  CLOSED: ['Closed', 'neutral'],
  CANCELED: ['Cancelled', 'neutral'],
};
