import { z } from 'zod';
import { DateTime } from 'luxon';
import { objectId, paise } from '../../utils/schemas.js';
import { GST_RATES_BPS, LINE_KINDS } from '../../config/billing.js';
import { GST_SCHEMES, ITC_TYPES, TAX_CODE_REGEX, TAX_ENTRY_TYPES } from '../../config/gst.js';

const date = z.string().refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v) && DateTime.fromISO(v).isValid, 'Choose a date');
const state = z.string().regex(/^\d{2}$/, 'Choose a state');
const beforeEnd = (rule) => !rule.to || !rule.from || rule.to >= rule.from;

export const setupSchema = z.object({
  scheme: z.enum(GST_SCHEMES),
  startMonth: z.string().regex(/^(\d{4}-(0[1-9]|1[0-2]))?$/, 'Choose a month').refine((v) => !v || v >= '2017-07', 'GST began in July 2017').optional(),
  pricesIncludeTax: z.boolean().optional(),
  reason: z.string().trim().max(300).optional(),
});

export const registrationSchema = z.object({
  gstin: z.string().trim().toUpperCase().length(15, 'A GSTIN has 15 characters'),
  legalName: z.string().trim().min(2, 'Enter the legal name').max(120),
  stateCode: state,
  from: date,
  branchIds: z.array(objectId).min(1, 'Choose at least one branch').max(100),
  move: z.boolean().optional(), // close these branches' current GSTIN the day before
});

export const linkSchema = z.object({ branchId: objectId, from: date, move: z.boolean().optional() });

const ruleFields = {
  code: z.string().trim().regex(TAX_CODE_REGEX, 'The code is 4 to 8 digits'),
  rateBps: z.number().int().refine((v) => GST_RATES_BPS.includes(v), 'Choose a GST rate from the list'),
  itcType: z.enum(ITC_TYPES),
  from: date,
  to: date.nullable().optional(),
};
const datesInOrder = { path: ['to'], message: 'The end date is before the start date' };

export const createRuleSchema = z
  .object({ groupId: objectId.optional(), name: z.string().trim().min(2, 'Give the rule a name').max(80).optional(), kind: z.enum(LINE_KINDS).optional(), ...ruleFields })
  .refine(beforeEnd, datesInOrder);

export const updateRuleSchema = z
  .object({ name: z.string().trim().min(2, 'Give the rule a name').max(80), ...ruleFields })
  .partial()
  .refine(beforeEnd, datesInOrder);

export const approveRuleSchema = z.object({ reviewedBy: z.string().trim().min(2, 'Say who reviewed this rule').max(120) });

export const testBillSchema = z.object({
  branchId: objectId,
  placeOfSupply: z.string().regex(/^(\d{2})?$/, 'Choose a state').optional(),
  date: date.optional(),
  billDiscount: z.object({ type: z.enum(['flat', 'percent']), value: z.number().min(0) }).nullable().optional(),
  lines: z.array(z.object({ groupId: objectId, name: z.string().trim().max(80).optional(), unitPrice: paise, qty: z.number().int().min(1).max(999).default(1) })).min(1, 'Add a line').max(20),
});

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month');
export const overviewSchema = z.object({ month: month.optional(), gstin: z.string().trim().toUpperCase().length(15).optional() });
export const registerSchema = overviewSchema.extend({
  type: z.enum(TAX_ENTRY_TYPES).optional(),
  search: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  format: z.enum(['json', 'csv']).default('json'),
});
