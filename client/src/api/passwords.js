import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from './client';

// No login needed: can "Forgot password?" work here (email set up), and the password rule
export function useAuthOptions() {
  return useQuery({ queryKey: ['auth-options'], queryFn: () => api.get('/auth/options').then((res) => res.data), staleTime: 5 * 60_000 });
}

// { email } -> the same message whether or not the email has an account
export function useForgotPassword() {
  return useMutation({ mutationFn: ({ email }) => api.post('/auth/forgot-password', { email }).then((res) => res.data) });
}

// Is the link in the email still good? -> { purpose: 'RESET' | 'INVITE', name }
export function useCheckPasswordLink(token) {
  return useQuery({
    queryKey: ['password-link', token],
    queryFn: () => api.post('/auth/reset-password/check', { token }).then((res) => res.data),
    enabled: Boolean(token),
    retry: false,
    staleTime: Infinity,
  });
}

// { token, password }
export function useResetPassword() {
  return useMutation({ mutationFn: ({ token, password }) => api.post('/auth/reset-password', { token, password }).then((res) => res.data) });
}

// An owner emails a team member a link to set their password -> { email, emailed }
export function useEmailPasswordLink() {
  return useMutation({ mutationFn: (id) => api.post(`/users/${id}/email-password-link`).then((res) => res.data) });
}
