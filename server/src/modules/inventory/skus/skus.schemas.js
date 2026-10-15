import { z } from 'zod';
import { BASE_UNITS, SKU_TYPES, WAYS_OF_USE } from '../../../config/inventory.js';
import { paise } from '../../../utils/schemas.js';

const wholeNumber = z.number().int('Use a whole number').min(0, 'Can’t be below zero');
// Optional text: an empty box is the same as leaving it out
const optionalText = (max) => z.string().trim().max(max).optional().transform((v) => v || undefined);

const productFields = {
  name: z.string().trim().min(2, 'Name is required').max(120),
  category: z.string().trim().min(1, 'Category is required').max(60),
  stockUnit: z.string().trim().toLowerCase().min(1, 'Stock unit is required').max(20),
  wayOfUse: z.enum(WAYS_OF_USE),
  brand: optionalText(60),
  barcodes: z
    .array(z.string().trim().min(3, 'Barcode is too short').max(64))
    .max(5, 'At most 5 barcodes')
    .transform((codes) => [...new Set(codes)]),
  type: z.enum(SKU_TYPES),
  // Measured products only (hair colour, developer): e.g. 'ml' and 1000 for a 1000 ml bottle
  baseUnit: z.enum(BASE_UNITS).nullable(),
  unitsPerStockUnit: z.number().int('Use a whole number').min(1, 'At least 1'),
};

// Reorder levels for the selected branch (counted like the stock: ml for measured products)
const branchFields = {
  reorderPoint: wholeNumber.nullable().optional(),
  reorderQty: wholeNumber.nullable().optional(),
  leadTimeDays: z.number().int().min(0).max(365).nullable().optional(),
};

const measuredNeedsUnits = (p, ctx) => {
  if (p.wayOfUse === 'SERVICE_MEASURED' && (!p.baseUnit || !p.unitsPerStockUnit)) {
    ctx.addIssue({ code: 'custom', path: ['baseUnit'], message: 'Say how it is measured, e.g. 1000 ml per bottle' });
  }
};

// Add product: only name, category, stock unit, way of use and opening quantity are needed
export const createSkuSchema = z
  .object({
    ...productFields,
    barcodes: productFields.barcodes.default([]),
    type: productFields.type.default('PROFESSIONAL'),
    baseUnit: productFields.baseUnit.optional(),
    unitsPerStockUnit: productFields.unitsPerStockUnit.optional(),
    brand: productFields.brand,
    // Own code instead of the automatic SKU-000123
    code: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9-]{2,30}$/, 'Use letters, numbers and dashes only')
      .optional()
      .or(z.literal('').transform(() => undefined)),
    ...branchFields,
    // Opening stock, counted like the stock (ml for measured products). Posted as an opening movement.
    openingQty: wholeNumber.optional(),
    // Price paid per stock unit (per bottle), in paise. Owners who see costs only.
    openingUnitCost: paise.optional(),
  })
  .superRefine(measuredNeedsUnits)
  .refine((p) => p.openingUnitCost == null || p.openingQty > 0, { path: ['openingUnitCost'], message: 'A cost needs an opening quantity' });

// Edit: send the version you loaded, so someone else's newer change isn't overwritten
export const updateSkuSchema = z
  .object({
    version: z.number().int().min(1),
    ...Object.fromEntries(Object.entries(productFields).map(([key, schema]) => [key, schema.optional()])),
    brand: z.string().trim().max(60).optional(), // an empty box clears the brand
    ...branchFields,
  })
  .superRefine((p, ctx) => p.wayOfUse && measuredNeedsUnits(p, ctx));

export const skuStatusSchema = z.object({
  version: z.number().int().min(1),
  status: z.enum(['active', 'inactive']),
});

const flag = z.enum(['true', 'false']).transform((v) => v === 'true');

export const listSkusSchema = z.object({
  search: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  wayOfUse: z.enum(WAYS_OF_USE).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
  needToOrder: flag.optional(),
  // branch: products used at the selected branch. salon: the salon's other products, not used here yet
  scope: z.enum(['branch', 'salon']).default('branch'),
  page: z.coerce.number().int().min(1).default(1),
});

export const pageSchema = z.object({ page: z.coerce.number().int().min(1).default(1) });
