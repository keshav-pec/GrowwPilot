import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

// Overview tab: { totals, needToOrder, handover, waitingRequests, recent }
export function useOverview() {
  return useQuery({
    queryKey: ['inventory', 'overview'],
    queryFn: () => api.get('/inventory/overview').then((res) => res.data),
  });
}
