import { api } from '../client';
import { send, useInventoryMutation } from './request';

// Where a product photo is shown from (the login cookie goes with it). size: 'thumb' (240 px) or 'full' (1000 px)
export const imageUrl = (skuId, imageId, size = 'thumb') => `/api/inventory/skus/${skuId}/images/${imageId}?size=${size}`;

// The product's main photo (or its first), if it has any
export const mainImage = (sku) => sku?.images?.find((i) => i.isMain) ?? sku?.images?.[0] ?? null;

// { key, skuId, files: File[] } -> { images }
export const useAddImages = () =>
  useInventoryMutation(({ key, skuId, files }) => {
    const form = new FormData();
    for (const file of files) form.append('images', file);
    return api.post(`/inventory/skus/${skuId}/images`, form, { headers: { 'Idempotency-Key': key } }).then((res) => res.data);
  });

export const useSetMainImage = () => useInventoryMutation(({ key, skuId, imageId }) => send('patch', `/inventory/skus/${skuId}/images/${imageId}`, key, { isMain: true }));
export const useRemoveImage = () => useInventoryMutation(({ key, skuId, imageId }) => send('delete', `/inventory/skus/${skuId}/images/${imageId}`, key));

// Which products do these file names belong to? -> { files: [{ fileName, status, skuId, skuName, code, message }], matched }
export const matchBulkFiles = (fileNames) => api.post('/inventory/skus/images/bulk-match', { fileNames }).then((res) => res.data);
