import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// Write-offs waiting for approval and problems reported (the front desk: their own reports)
export function useRequests() {
  return useQuery({
    queryKey: ['inventory', 'requests'],
    queryFn: () => api.get('/inventory/requests').then((res) => res.data.requests),
  });
}

// { key, skuId, allocationId?, locationId?, reason, qty?, note }
export const useReportProblem = () => useInventoryMutation(({ key, ...values }) => send('post', '/inventory/requests/reports', key, values));

// { key, id, approve, note? }
export const useDecideRequest = () => useInventoryMutation(({ key, id, ...values }) => send('post', `/inventory/requests/${id}/decide`, key, values));

// { key, id, note }
export const useDismissReport = () => useInventoryMutation(({ key, id, note }) => send('post', `/inventory/requests/${id}/dismiss`, key, { note }));
