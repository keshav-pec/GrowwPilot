import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

export function useSuppliers({ includeInactive = false } = {}) {
  return useQuery({
    queryKey: ['inventory', 'suppliers', includeInactive],
    queryFn: () => api.get('/inventory/suppliers', { params: { includeInactive } }).then((res) => res.data.suppliers),
  });
}

// { key, ...supplier } new, or { key, _id, ...changes }
export const useSaveSupplier = () =>
  useInventoryMutation(({ key, _id, ...values }) => (_id ? send('patch', `/inventory/suppliers/${_id}`, key, values) : send('post', '/inventory/suppliers', key, values)));
