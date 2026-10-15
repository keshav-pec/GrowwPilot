import { BASE_UNITS, SKU_TYPES, WAYS_OF_USE } from '../../../config/inventory.js';

// Spreadsheet (CSV) import rules: the columns, and checking one row. Nothing is guessed:
// an empty cost or quantity stays empty, and anything unclear is reported instead of fixed silently.

export const MAX_IMPORT_ROWS = 2000;
export const REQUIRED_COLUMNS = ['name', 'category', 'stock_unit', 'way_of_use'];
export const IMPORT_COLUMNS = [
  ...REQUIRED_COLUMNS,
  'opening_qty',
  'sku_code',
  'brand',
  'barcode',
  'type',
  'base_unit',
  'units_per_stock_unit',
  'reorder_point',
  'reorder_qty',
  'unit_cost',
];

// "Per service, whole units" -> "PER_SERVICE_WHOLE_UNITS"
const asCode = (text) => text.trim().toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_|_$/g, '');

// The codes, plus the words the screens use, so a file filled in by hand still works
const WAY_OF_USE_WORDS = {
  ...Object.fromEntries(WAYS_OF_USE.map((w) => [w, w])),
  PER_SERVICE_WHOLE_UNITS: 'SERVICE_UNITS',
  PER_SERVICE_UNITS: 'SERVICE_UNITS',
  PER_SERVICE_BY_MEASURE: 'SERVICE_MEASURED',
  MEASURED: 'SERVICE_MEASURED',
  BY_HAND: 'MANUAL',
};
const TYPE_WORDS = { ...Object.fromEntries(SKU_TYPES.map((t) => [t, t])), REUSABLE_ITEM: 'REUSABLE_ASSET' };
const BASE_UNIT_WORDS = { ml: 'ml', g: 'g', piece: 'piece', pieces: 'piece', pcs: 'piece' };

const LIMITS = { name: 120, category: 60, stock_unit: 20, brand: 60 };

// Checks one row. raw: { name: 'Shampoo', opening_qty: '10', ... } (all text, as in the file).
// Returns { values, problems }: values are ready to save; problems are { field, level: 'error' | 'warning', message }.
export function checkImportRow(raw, { canSeeCosts }) {
  const problems = [];
  const error = (field, message) => problems.push({ field, level: 'error', message });
  const warning = (field, message) => problems.push({ field, level: 'warning', message });
  const text = (field) => String(raw[field] ?? '').trim();

  const wholeNumber = (field, { min = 0 } = {}) => {
    const value = text(field);
    if (value === '') return null;
    if (!/^\d+$/.test(value) || Number(value) < min) {
      error(field, `“${value}” isn’t a whole number${min > 0 ? ` of at least ${min}` : ''}`);
      return null;
    }
    return Number(value);
  };

  // Required
  const values = { name: text('name'), category: text('category'), stockUnit: text('stock_unit').toLowerCase() };
  if (values.name.length < 2) error('name', 'Name is missing');
  if (!values.category) error('category', 'Category is missing');
  if (!values.stockUnit) error('stock_unit', 'Stock unit is missing (bottle, jar, kit...)');
  for (const [field, max] of Object.entries(LIMITS)) {
    if (text(field).length > max) error(field, `Too long (at most ${max} characters)`);
  }

  const wayText = text('way_of_use');
  values.wayOfUse = WAY_OF_USE_WORDS[asCode(wayText)] ?? null;
  if (!wayText) error('way_of_use', 'Way of use is missing');
  else if (!values.wayOfUse) error('way_of_use', `“${wayText}” isn’t a way of use. Use FINISH, SERVICE_UNITS, SERVICE_MEASURED or MANUAL.`);

  // How it is counted: measured products need their unit and how much is in one
  values.baseUnit = null;
  values.unitsPerStockUnit = 1;
  if (values.wayOfUse === 'SERVICE_MEASURED') {
    const unitText = text('base_unit').toLowerCase();
    values.baseUnit = BASE_UNIT_WORDS[unitText] ?? null;
    if (!values.baseUnit) error('base_unit', unitText ? `“${unitText}” isn’t a unit. Use ${BASE_UNITS.join(', ')}.` : 'Measured products need a base unit (ml, g or piece)');
    const per = wholeNumber('units_per_stock_unit', { min: 1 });
    if (per == null && !problems.some((p) => p.field === 'units_per_stock_unit')) {
      error('units_per_stock_unit', `Say how much is in one ${values.stockUnit || 'unit'}, e.g. 1000`);
    }
    values.unitsPerStockUnit = per ?? 1;
  }

  // Optional
  values.openingQty = wholeNumber('opening_qty');
  values.reorderPoint = wholeNumber('reorder_point');
  values.reorderQty = wholeNumber('reorder_qty');
  values.brand = text('brand') || undefined;

  const typeText = text('type');
  values.type = typeText ? (TYPE_WORDS[asCode(typeText)] ?? null) : 'PROFESSIONAL';
  if (!values.type) error('type', `“${typeText}” isn’t a product type. Use ${SKU_TYPES.join(', ')}.`);

  const code = text('sku_code').toUpperCase();
  values.code = code || undefined;
  if (code && !/^[A-Z0-9-]{2,30}$/.test(code)) error('sku_code', 'Use letters, numbers and dashes only');

  // Several barcodes can be separated with ; or |
  values.barcodes = [...new Set(text('barcode').split(/[;|]/).map((b) => b.trim()).filter(Boolean))];
  if (values.barcodes.some((b) => b.length < 3 || b.length > 64)) error('barcode', 'A barcode must be 3 to 64 characters');

  // Cost per stock unit (per bottle), in rupees. Only from people who may see costs, and only with stock.
  const costText = text('unit_cost').replace(/^₹\s*/, '');
  values.openingUnitCost = null;
  if (costText) {
    if (!/^\d+(\.\d{1,2})?$/.test(costText)) error('unit_cost', `“${costText}” isn’t an amount. Write it like 450 or 450.50.`);
    else if (!canSeeCosts) warning('unit_cost', 'Only owners can enter costs, so this cost was left out');
    else if (!values.openingQty) warning('unit_cost', 'Left out: there is no opening quantity for this cost');
    else values.openingUnitCost = Math.round(Number(costText) * 100);
  }

  return { values, problems };
}

// error beats warning beats ready
export function rowStatus(problems) {
  if (problems.some((p) => p.level === 'error')) return 'error';
  return problems.length > 0 ? 'warning' : 'ready';
}
