import { z } from 'zod';
import { objectId } from '../../utils/schemas.js';
import { CAMPAIGN_SCOPES, CONSENT_CHANNELS, CONSENT_SOURCES, DISCOUNT_TYPES, OCCASION_TYPES, dayFitsMonth } from '../../config/occasions.js';

// A birthday or anniversary: { month: 11, day: 5 }, { month: 11 } (no day) or null (clear it). Never a year.
export const occasionDate = z
  .object({
    month: z.number().int().min(1, 'Choose a month').max(12, 'Choose a month'),
    day: z.number().int().min(1).max(31).nullable().optional(),
  })
  .refine((d) => d.day == null || dayFitsMonth(d.month, d.day), { message: 'That day is not in the chosen month', path: ['day'] })
  .nullable();

export const datesSchema = z
  .object({ birthday: occasionDate.optional(), anniversary: occasionDate.optional(), homeBranchId: objectId.optional() })
  .refine((d) => d.birthday !== undefined || d.anniversary !== undefined || d.homeBranchId !== undefined, 'Nothing to change');

// Record or withdraw permission on one channel
export const consentSchema = z.object({
  channel: z.enum(CONSENT_CHANNELS),
  status: z.enum(['OPTED_IN', 'OPTED_OUT']),
  source: z.enum(CONSENT_SOURCES.filter((s) => s !== 'DATA_REMOVAL'), { message: 'Choose how the customer told you' }),
  agreed: z.boolean().default(false), // the consent tick box (starts unticked)
  customerAsked: z.boolean().default(false), // "Customer asked for this" (needed from the front desk)
  note: z.string().trim().max(500).optional(),
});

export const reasonSchema = z.object({ reason: z.string().trim().min(3, 'Please give a reason').max(500) });

export const settingsSchema = z.object({
  enabled: z.boolean().optional(),
  consentText: z
    .string()
    .trim()
    .min(20, 'The wording is too short')
    .max(500)
    .refine((text) => /opt[\s-]?out/i.test(text), 'The wording must say the customer can opt out')
    .optional(),
  channelOrder: z
    .array(z.enum(CONSENT_CHANNELS))
    .length(CONSENT_CHANNELS.length)
    .refine((list) => new Set(list).size === list.length, 'Each channel once')
    .optional(),
});

// If-Match: the settings version the screen loaded ("3" or "\"3\"")
export const ifMatchSchema = z.object({
  'if-match': z
    .string({ message: 'Missing If-Match header' })
    .transform((v) => v.replace(/^W\//, '').replaceAll('"', ''))
    .pipe(z.coerce.number().int().min(0)),
});

// Spreadsheet import: the browser reads the CSV and sends its rows as text
export const MAX_IMPORT_ROWS = 5000;
export const IMPORT_COLUMNS = ['customer_id', 'name', 'phone', 'birthday_month', 'birthday_day', 'anniversary_month', 'anniversary_day'];
export const importSchema = z.object({
  checkOnly: z.boolean().default(true),
  rows: z
    .array(z.object(Object.fromEntries(IMPORT_COLUMNS.map((c) => [c, z.string().max(200).optional()]))))
    .min(1, 'The file has no rows')
    .max(MAX_IMPORT_ROWS, `Import at most ${MAX_IMPORT_ROWS} rows at a time`),
});

// Campaign terms. PERCENT: value in basis points (1500 = 15%). FLAT: value in paise. Checked fully in campaign.rules.js.
const whole = z.number().int('Use a whole number');
export const rulesSchema = z.object({
  discountType: z.enum(DISCOUNT_TYPES, { message: 'Choose % off or ₹ off' }),
  value: whole,
  maxDiscount: whole.nullable().optional(),
  minSubtotal: whole.min(0).default(0),
  serviceIds: z.array(objectId).max(1000).default([]),
});

export const createCampaignSchema = z.object({
  type: z.enum(OCCASION_TYPES),
  scope: z.enum(CAMPAIGN_SCOPES),
  branchId: objectId.nullable().optional(),
  name: z.string().trim().min(2, 'Give the campaign a name').max(80),
  rules: rulesSchema,
});

export const updateCampaignSchema = createCampaignSchema.partial();
