import { z } from 'zod';

const name = z.string().trim().min(2, 'Name is required').max(40);

// Main store and In use are made automatically; owners add more stores and stations
export const createLocationSchema = z.object({
  kind: z.enum(['STORE', 'STATION']),
  name,
});

export const updateLocationSchema = z.object({
  name: name.optional(),
  active: z.boolean().optional(),
});
