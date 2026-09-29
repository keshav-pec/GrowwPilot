import { z } from 'zod';
import { objectId } from '../../utils/schemas.js';

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

// GET /api/analytics?from=2026-09-01&to=2026-09-30&branchId=all
export const analyticsSchema = z
  .object({
    from: date,
    to: date,
    branchId: z.union([z.literal('all'), objectId]).default('all'),
  })
  .refine((q) => q.from <= q.to, { message: '"From" must be on or before "to"', path: ['to'] })
  .refine((q) => (new Date(q.to) - new Date(q.from)) / 86_400_000 <= 366, { message: 'Choose a range of one year or less', path: ['from'] });
