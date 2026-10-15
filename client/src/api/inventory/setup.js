import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// The first-time setup guide for the selected branch: { completedAt, steps, counts }
export function useSetup() {
  return useQuery({
    queryKey: ['inventory', 'setup'],
    queryFn: () => api.get('/inventory/setup').then((res) => res.data),
  });
}

// { key, step: 'locations' | 'done' }
export const useMarkSetupStep = () => useInventoryMutation(({ key, step }) => send('post', '/inventory/setup/steps', key, { step }));
