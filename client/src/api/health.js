import { useQuery } from '@tanstack/react-query';
import { api } from './client';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health').then((res) => res.data),
  });
}
