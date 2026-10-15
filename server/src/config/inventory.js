// Fixed lists for the Inventory add-on (INVENTORY_PLAN.md).

// What kind of product it is
export const SKU_TYPES = ['PROFESSIONAL', 'RETAIL', 'DISPOSABLE', 'GENERAL_SUPPLY', 'REUSABLE_ASSET'];

// The four ways stock is used:
// FINISH           whole bottles handed out, used up when someone marks them finished
// SERVICE_UNITS    a set number of units used up each time a service is completed
// SERVICE_MEASURED a set number of ml / g / pieces used up each time a service is completed
// MANUAL           someone records use by hand
export const WAYS_OF_USE = ['FINISH', 'SERVICE_UNITS', 'SERVICE_MEASURED', 'MANUAL'];

// Measured products are counted in one of these (whole numbers only)
export const BASE_UNITS = ['ml', 'g', 'piece'];

// STORE: shelves (Main store, more can be added). IN_USE: opened / handed out (one per branch).
// STATION: a named chair or area that receives stock. Its stock sits in IN_USE, it has no balance of its own.
export const LOCATION_KINDS = ['STORE', 'IN_USE', 'STATION'];
export const BALANCE_KINDS = ['STORE', 'IN_USE'];

// One row per action in the movement history
export const MOVEMENT_TYPES = [
  'OPENING', // opening stock when a product is added
  'RECEIPT', // a delivery arrived
  'ISSUE', // store -> in use
  'RETURN', // in use -> store (unused)
  'TRANSFER', // a hand-out moved to someone else (nothing used)
  'FINISH', // a bottle in use was finished
  'SERVICE_USE', // used up by a completed service
  'WRITE_OFF', // used by hand, damaged, expired, lost, spilled
  'ADJUSTMENT', // a count was wrong (found more or less than the books say)
  'COUNT_CORRECTION', // difference found in a stock count
  'CORRECTION', // fixes an earlier movement (points at it)
  'RETURN_TO_SUPPLIER',
];

// What each movement line means for reports. MOVED = from one place to another, the branch total is unchanged.
export const LEDGER_BUCKETS = ['OPENING', 'RECEIVED', 'MOVED', 'CONSUMED', 'WASTED', 'ADJUSTED', 'RETURNED'];

// Who has a hand-out: the salon floor, a station, or a stylist
export const RECIPIENT_KINDS = ['FLOOR', 'STATION', 'STAFF'];

// Measured products are counted in their base unit (ml, g, piece); all others in their stock unit (bottle, kit...)
export const isMeasured = (sku) => sku.wayOfUse === 'SERVICE_MEASURED';

// Why stock was used or written off by hand. A lost bottle is LOSS, never FINISH.
export const WRITE_OFF_REASONS = ['DIRECT_USE', 'DAMAGE', 'EXPIRY', 'LOSS', 'SPILLAGE', 'STOCK_COUNT_CORRECTION'];
// Reports keep waste apart from normal use: direct use is consumption, the rest is waste or a correction
export const REASON_BUCKET = { DIRECT_USE: 'CONSUMED', STOCK_COUNT_CORRECTION: 'ADJUSTED', DAMAGE: 'WASTED', EXPIRY: 'WASTED', LOSS: 'WASTED', SPILLAGE: 'WASTED' };
