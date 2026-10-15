import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../client';

// Every Inventory change is sent with an Idempotency-Key (see newRequestKey in lib/inventory.js)
export function send(method, url, key, body) {
  return api.request({ method, url, data: body, headers: { 'Idempotency-Key': key } }).then((res) => res.data);
}

// A change that refreshes every Inventory screen (and the bell) when it works
export function useInventoryMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory'] });
      queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
  });
}
