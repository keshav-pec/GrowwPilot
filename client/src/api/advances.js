import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// A customer's advances: { balance, advances: [{ amount, remaining, note, uses: [{ invoiceNumber, amount }] }] }
export function useAdvances(customerId) {
  return useQuery({
    queryKey: ['advances', customerId],
    queryFn: () => api.get('/advances', { params: { customerId } }).then((res) => res.data),
    enabled: Boolean(customerId),
  });
}

// { key, customerId, method, amount, reference?, note? }
export function useTakeAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }) => api.post('/advances', body, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
    onSuccess: (data, { customerId }) => queryClient.setQueryData(['advances', customerId], data),
  });
}
