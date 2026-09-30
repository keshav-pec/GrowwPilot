import { useMutation } from '@tanstack/react-query';
import { api } from './client';

// Every reply looks like: { kind, topic, answer, link, suggestions }
//   kind: 'answer' | 'not-allowed' (your role can't do it) | 'fallback' (not understood)

export const fetchWelcome = () => api.get('/help/start').then((res) => res.data);

export function useAskAssistant() {
  return useMutation({
    mutationFn: (message) => api.post('/help/ask', { message }).then((res) => res.data),
  });
}
