import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { keyed } from './request';

// Email (business owner): is email on, how much of the daily limit is used
export function useMailStatus() {
  // Branch owners get 403 here (they see only the recent emails): don't ask again
  return useQuery({ queryKey: ['mail-status'], queryFn: () => api.get('/mail/status').then((res) => res.data), retry: (count, err) => err.status !== 403 && count < 2 });
}

// { key } -> { id, to }: a test email to my own login email
export function useSendTestEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key }) => api.post('/mail/test', null, keyed(key)).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['mail-status'] }),
  });
}

// How the test email is doing; asks every 2 seconds until it is Sent, Failed or Skipped
export function useTestEmail(id) {
  return useQuery({
    queryKey: ['mail-test', id],
    queryFn: () => api.get(`/mail/test/${id}`).then((res) => res.data),
    enabled: Boolean(id),
    refetchInterval: (query) => (['PENDING', 'SENDING'].includes(query.state.data?.status ?? 'PENDING') ? 2000 : false),
  });
}

// Recent emails (owners: business owner all, branch owner their branches). filters: { kind, status, from, to, page }
export function useMailLog(filters) {
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v));
  return useQuery({
    queryKey: ['mail-log', params],
    queryFn: () => api.get('/mail/log', { params }).then((res) => res.data),
    placeholderData: (previous) => previous,
  });
}
