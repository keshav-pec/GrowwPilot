import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from './client';

// { branch, date, generatedAt, kpis, pulse, attention } for the selected branch, refreshed every minute
export function useDashboard() {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['dashboard', activeBranchId],
    queryFn: () => api.get('/dashboard').then((res) => res.data),
    refetchInterval: 60_000,
  });
}
