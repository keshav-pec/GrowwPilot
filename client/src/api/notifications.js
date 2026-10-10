import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// { items, unread } — checked every minute so new messages show up on their own
export function useNotifications() {
  return useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get('/notifications').then((res) => res.data),
    refetchInterval: 60_000,
  });
}

// ids: the messages to mark read, or nothing for all of them
export function useMarkNotificationsRead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (ids) => api.post('/notifications/read', ids ? { ids } : {}).then((res) => res.data),
    onSuccess: (data) => queryClient.setQueryData(['notifications'], data),
  });
}
