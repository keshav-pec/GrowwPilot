import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// After a refund changes: the bill, lists, customer spend, stock, the bell
function useRefundMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (data) => {
      if (data?.invoice?._id) queryClient.setQueryData(['invoice', data.invoice._id], data.invoice);
      for (const key of ['invoices', 'customers', 'advances', 'dashboard', 'notifications', 'inventory']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

// What a refund of these lines would do: { lines, creditTotal, cashRefund, dueReduced }
export function useRefundQuote(invoiceId, lines, enabled) {
  return useQuery({
    queryKey: ['refund-quote', invoiceId, lines],
    queryFn: () => api.post('/refunds/quote', { invoiceId, lines }).then((res) => res.data),
    enabled,
    retry: false,
    staleTime: 0,
  });
}

// { key, invoiceId, lines: [{ lineId, qty, restock }], reason, method, reference } -> { refund, invoice }
export const useCreateRefund = () => useRefundMutation(({ key, ...body }) => api.post('/refunds', body, { headers: { 'Idempotency-Key': key } }).then((res) => res.data));
// { _id, key, method?, reference? }
export const useApproveRefund = () => useRefundMutation(({ _id, key, ...body }) => api.post(`/refunds/${_id}/approve`, body, { headers: { 'Idempotency-Key': key } }).then((res) => res.data));
// { _id, key, note }
export const useRejectRefund = () => useRefundMutation(({ _id, key, note }) => api.post(`/refunds/${_id}/reject`, { note }, { headers: { 'Idempotency-Key': key } }).then((res) => res.data));

// One refund with its credit note: { refund, creditNote, branch }
export function useRefund(id) {
  return useQuery({ queryKey: ['refund', id], queryFn: () => api.get(`/refunds/${id}`).then((res) => res.data), enabled: Boolean(id) });
}
