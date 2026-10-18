import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Billing settings (owners): salon GST details, per-branch GSTIN and bill prefix, front desk discount limit
export function useBillingSettings(enabled = true) {
  return useQuery({ queryKey: ['billing-settings'], queryFn: () => api.get('/billing/settings').then((res) => res.data), enabled });
}

// { key, ...changes } -> the saved settings
export function useSaveBillingSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...values }) => api.patch('/billing/settings', values, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
    onSuccess: (settings) => queryClient.setQueryData(['billing-settings'], settings),
  });
}
