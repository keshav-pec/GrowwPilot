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

// A special commission rate for one service: basis points, 1500 = 15%, 0 = none
export const serviceRateSchema = z.object({
  rateBps: z.number().int('Use up to two decimals').min(0).max(10000, 'Commission can be at most 100%'),
});

// GET .../commission?month=2026-10
export const monthSchema = z.object({ month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM') });

const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Use YYYY-MM');

export const monthParamSchema = z.object({ month });

// A bonus or deduction for one person in one month, always with a reason
export const adjustmentSchema = z.object({
  staffId: objectId,
  month,
  kind: z.enum(['bonus', 'deduction']),
  amount: paise.min(1, 'Enter an amount'),
  reason: z.string().trim().min(3, 'Please give a reason').max(300),
  correctsMonth: month.optional(), // set when it fixes a month that is already locked
});

// Locking can't be undone, so the screen must send an explicit yes
export const lockSchema = z.object({ confirm: z.literal(true, 'Please confirm') });
