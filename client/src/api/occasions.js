import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { downloadFile } from './download';

// Birthday & Anniversary Offers

// Settings → Occasion offers (owners): the switch, data counts, consent wording, version
export function useOccasionSettings() {
  return useQuery({ queryKey: ['occasions', 'settings'], queryFn: () => api.get('/occasions/settings').then((res) => res.data) });
}

// { key, version, ...changes }. Switching on or off also refreshes the login session (the sidebar reads it).
export function useSaveOccasionSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, version, ...values }) =>
      api.put('/occasions/settings', values, { headers: { 'Idempotency-Key': key, 'If-Match': `"${version}"` } }).then((res) => res.data),
    onSuccess: (settings) => {
      queryClient.setQueryData(['occasions', 'settings'], settings);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// A customer's messaging permission: { channels, wording, noticeVersion, can }
export function useConsents(customerId) {
  return useQuery({ queryKey: ['occasions', 'consents', customerId], queryFn: () => api.get(`/occasions/customers/${customerId}/consents`).then((res) => res.data) });
}

export function useConsentHistory(customerId) {
  return useQuery({
    queryKey: ['occasions', 'consents', customerId, 'history'],
    queryFn: () => api.get(`/occasions/customers/${customerId}/consents/history`).then((res) => res.data.events),
  });
}

// Record or withdraw one channel: { key, channel, status, source, agreed, customerAsked, note }
export function useChangeConsent(customerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }) => api.post(`/occasions/customers/${customerId}/consents`, body, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['occasions', 'consents', customerId] }),
  });
}

// Business owner: clear the dates and opt out of every channel. { key, reason }
export function useRemoveOccasionData(customerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, reason }) => api.post(`/occasions/customers/${customerId}/remove-data`, { reason }, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occasions'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export const downloadDatesTemplate = () => downloadFile('/occasions/import/template', undefined, 'customer-occasions.csv');

// { rows, checkOnly, key? } -> { total, toSave, unchanged, rejected, saved }
export function useImportDates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }) => api.post('/occasions/import', body, { headers: key ? { 'Idempotency-Key': key } : {} }).then((res) => res.data),
    onSuccess: (result) => {
      if (result.saved > 0) {
        queryClient.invalidateQueries({ queryKey: ['occasions', 'settings'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      }
    },
  });
}
