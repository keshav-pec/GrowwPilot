import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// Services that couldn't take their stock (exceptions) and events that failed, at the selected branch
export function useAutomation(enabled = true) {
  return useQuery({
    queryKey: ['inventory', 'automation'],
    queryFn: () => api.get('/inventory/automation').then((res) => res.data),
    enabled,
  });
}

export const usePostException = () => useInventoryMutation(({ key, id }) => send('post', `/inventory/automation/exceptions/${id}/post`, key));

export const useDismissException = () => useInventoryMutation(({ key, id, note }) => send('post', `/inventory/automation/exceptions/${id}/dismiss`, key, { note }));

export const useRetryEvent = () => useInventoryMutation(({ id }) => api.post(`/inventory/automation/events/${id}/retry`).then((res) => res.data));

// "Used 110 ml, not 90": { key, id (the service use), actualQty, note? }
export const useCorrectServiceUse = () =>
  useInventoryMutation(({ key, id, ...values }) => send('post', `/inventory/automation/uses/${id}/correct`, key, values));
