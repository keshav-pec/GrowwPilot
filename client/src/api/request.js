import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// The Idempotency-Key header for a change (see lib/requestKey.js)
export const keyed = (key, extra = {}) => ({ headers: { 'Idempotency-Key': key, ...extra } });

// Sends a change, with an Idempotency-Key when there is one, and gives back the reply's data
export function send(method, url, key, body) {
  return api.request({ method, url, data: body, ...(key ? keyed(key) : {}) }).then((res) => res.data);
}

// A change that reloads these lists when it works
export function useChange(mutationFn, refresh) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => refresh.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] })),
  });
}
