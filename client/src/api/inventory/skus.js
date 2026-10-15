import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// Products at the selected branch. filters: { search, category, wayOfUse, status, needToOrder, scope, page }
export const fetchSkus = (filters) => api.get('/inventory/skus', { params: filters }).then((res) => res.data);

export function useSkus(filters) {
  return useQuery({
    queryKey: ['inventory', 'skus', filters],
    queryFn: () => fetchSkus(filters),
    placeholderData: keepPreviousData, // keep the list on screen while the next search loads
  });
}

// Product page: { sku, usedHere, branch, totals, balances, handouts, canEdit, canSetReorder }
export function useSku(id) {
  return useQuery({
    queryKey: ['inventory', 'sku', id],
    queryFn: () => api.get(`/inventory/skus/${id}`).then((res) => res.data),
    enabled: Boolean(id),
  });
}

export function useSkuMovements(id, page) {
  return useQuery({
    queryKey: ['inventory', 'sku-movements', id, page],
    queryFn: () => api.get(`/inventory/skus/${id}/movements`, { params: { page } }).then((res) => res.data),
    enabled: Boolean(id),
    placeholderData: keepPreviousData,
  });
}

// { key, ...product } — new product. { key, _id, version, ...changes } — edit.
export const useSaveSku = () =>
  useInventoryMutation(({ key, _id, ...values }) => (_id ? send('patch', `/inventory/skus/${_id}`, key, values) : send('post', '/inventory/skus', key, values)));

export const useSetSkuStatus = () => useInventoryMutation(({ key, _id, ...values }) => send('patch', `/inventory/skus/${_id}/status`, key, values));

export const useUseSkuHere = () => useInventoryMutation(({ key, _id }) => send('post', `/inventory/skus/${_id}/use-here`, key));
