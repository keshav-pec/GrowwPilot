import { z } from 'zod';
import { IMPORT_COLUMNS, MAX_IMPORT_ROWS } from './imports.rules.js';
import { objectId } from '../../../utils/schemas.js';

// One cell: text (a number is accepted too), at most 200 characters. Columns we don't know are dropped.
const cell = z.union([z.string(), z.number()]).transform(String).pipe(z.string().max(200, 'A cell is too long')).optional();

export const previewImportSchema = z.object({
  fileName: z.string().trim().max(200).optional(),
  rows: z
    .array(z.object(Object.fromEntries(IMPORT_COLUMNS.map((column) => [column, cell]))))
    .min(1, 'The file has no rows')
    .max(MAX_IMPORT_ROWS, `At most ${MAX_IMPORT_ROWS} rows at a time. Split the file and import it in parts.`),
});

// Rows to leave out (by their line number in the file)
export const commitImportSchema = z.object({
  skipRows: z.array(z.number().int()).max(MAX_IMPORT_ROWS).default([]),
});

export const importParamsSchema = z.object({ id: objectId });
