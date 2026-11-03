import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Email (business owner): is email set up, how much of the daily limit is used
export function useMailStatus() {
  return useQuery({ queryKey: ['mail-status'], queryFn: () => api.get('/mail/status').then((res) => res.data) });
}

// { key } -> { id, to }: a test email to my own login email
export function useSendTestEmail() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key }) => api.post('/mail/test', null, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
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
