import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// { current, past, canApprove }
export function useStockCounts() {
  return useQuery({ queryKey: ['inventory', 'stock-counts'], queryFn: () => api.get('/inventory/stock-counts').then((res) => res.data) });
}

export const useStartCount = () => useInventoryMutation(({ key }) => send('post', '/inventory/stock-counts', key));

// Saving counted numbers as you go: { id, lines: [{ lineId, counted, reason }] }
export function useSaveCounts() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, lines }) => api.patch(`/inventory/stock-counts/${id}`, { lines }).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['inventory', 'stock-counts'] }),
  });
}

// step: 'submit' | 'approve' | 'send-back' | 'cancel'. { key, id, step, ...body }
export const useCountStep = () => useInventoryMutation(({ key, id, step, ...body }) => send('post', `/inventory/stock-counts/${id}/${step}`, key, body));
