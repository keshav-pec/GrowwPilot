import { useMutation } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// Step 1: check the file's rows. Saves nothing but a preview, so it needs no Idempotency-Key.
// { fileName, rows } -> { import: { _id, rows, counts } }
export function usePreviewImport() {
  return useMutation({
    mutationFn: (values) => api.post('/inventory/imports/preview', values).then((res) => res.data.import),
  });
}

// Step 2: add the products. { key, id, skipRows } -> { created, withStock, skipped }
export const useCommitImport = () => useInventoryMutation(({ key, id, skipRows }) => send('post', `/inventory/imports/${id}/commit`, key, { skipRows }));
