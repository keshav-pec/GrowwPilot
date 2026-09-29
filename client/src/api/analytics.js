import { useQuery } from '@tanstack/react-query';
import { api } from './client';

// filters: { from, to, branchId } (branchId 'all' = every branch you can see)
export function useAnalytics(filters) {
  return useQuery({
    queryKey: ['analytics', filters],
    queryFn: () => api.get('/analytics', { params: filters }).then((res) => res.data),
    placeholderData: (previous) => previous, // keep the old charts (dimmed) while new ones load
  });
}

// A normal link: the browser sends the login cookie and downloads the file the server names
export function analyticsPdfUrl(filters) {
  return `/api/analytics/export.pdf?${new URLSearchParams(filters)}`;
}
