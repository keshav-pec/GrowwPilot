import { z } from 'zod';
import { DateTime } from 'luxon';
import { PAY_MODELS } from '../../config/constants.js';
import { objectId, paise } from '../../utils/schemas.js';

// A real calendar day, e.g. "2026-11-01" (not "2026-02-30")
const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .refine((v) => DateTime.fromISO(v).isValid, 'Choose a valid date');

const optionalAmount = paise.nullable().optional();

// A pay setup. Money in paise; commission in basis points (10% = 1000).
// Which parts are needed depends on the model; that's checked in payPlan.rules.js.
export const planSchema = z.object({
  model: z.enum(PAY_MODELS),
  monthlyBase: optionalAmount,
  dailyRate: optionalAmount,
  hourlyRate: optionalAmount,
  assignmentRate: optionalAmount,
  commissionBps: z.number().int('Use up to two decimals for commission').min(0).max(10000, 'Commission can be at most 100%').nullable().optional(),
  effectiveFrom: day,
  note: z.string().trim().max(500).optional(),
});

// The front desk must say why
export const requestSchema = planSchema.extend({
  staffId: objectId,
  note: z.string().trim().min(3, 'Please give a reason for the change').max(500),
});

export const endPlanSchema = z.object({ effectiveTo: day });

export const decisionSchema = z.object({ note: z.string().trim().max(500).optional() });

export const listRequestsSchema = z.object({ status: z.enum(['pending', 'all']).default('pending') });
