import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { keyed } from './request';
import { downloadFile } from './download';

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
    mutationFn: ({ key, ...body }) => api.post('/advances', body, keyed(key)).then((res) => res.data),
    onSuccess: (data, { customerId }) => {
      queryClient.setQueryData(['advances', customerId], data);
      for (const name of ['customer-money', 'gst-overview', 'gst-register', 'gst-advances']) queryClient.invalidateQueries({ queryKey: [name] });
    },
  });
}

// What an advance for these services would carry in tax (nothing is saved)
export function useAdvanceQuote(body, enabled) {
  return useQuery({
    queryKey: ['advance-quote', body],
    queryFn: () => api.post('/advances/quote', body).then((res) => res.data),
    enabled,
    retry: false,
    staleTime: 0,
  });
}

// One advance, for its receipt voucher: { advance, branch, customer, uses }
export function useAdvance(id) {
  return useQuery({ queryKey: ['advance', id], queryFn: () => api.get(`/advances/${id}`).then((res) => res.data), enabled: Boolean(id) });
}

export const downloadAdvancePdf = (advance) => downloadFile(`/advances/${advance._id}/pdf`, {}, `Receipt_${advance.receiptNumber ?? advance._id}.pdf`);

// { key, _id, customerId, amount, method, reference?, reason }
export function useGiveBackAdvance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, _id, customerId, ...body }) => api.post(`/advances/${_id}/give-back`, body, keyed(key)).then((res) => res.data),
    onSuccess: (data, { customerId }) => {
      queryClient.setQueryData(['advances', customerId], data);
      for (const name of ['advance', 'customer-money', 'gst-overview', 'gst-register', 'gst-advances']) queryClient.invalidateQueries({ queryKey: [name] });
    },
  });
}
