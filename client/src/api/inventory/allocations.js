import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// Open hand-outs at the selected branch (optionally for one product), oldest first
export function useHandouts(skuId) {
  return useQuery({
    queryKey: ['inventory', 'handouts', skuId ?? 'all'],
    queryFn: () => api.get('/inventory/allocations', { params: { skuId } }).then((res) => res.data.handouts),
  });
}

// Who can receive stock: { floor, stations, staff }
export function useRecipients() {
  return useQuery({
    queryKey: ['inventory', 'recipients'],
    queryFn: () => api.get('/inventory/allocations/recipients').then((res) => res.data),
  });
}

// { key, skuId, locationId, recipient, qty, note? }
export const useIssue = () => useInventoryMutation(({ key, ...values }) => send('post', '/inventory/allocations', key, values));

// { key, id, qty, note?, replacement?: { qty, locationId?, recipient? } }
export const useFinish = () => useInventoryMutation(({ key, id, ...values }) => send('post', `/inventory/allocations/${id}/finish`, key, values));

// { key, id, qty, locationId?, note? }
export const useReturnUnused = () => useInventoryMutation(({ key, id, ...values }) => send('post', `/inventory/allocations/${id}/return`, key, values));

// { key, id, recipient, qty?, note? }
export const useMoveHandout = () => useInventoryMutation(({ key, id, ...values }) => send('post', `/inventory/allocations/${id}/move`, key, values));
