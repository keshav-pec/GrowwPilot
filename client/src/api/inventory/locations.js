import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// The selected branch's stores, In use and stations
export function useLocations() {
  return useQuery({
    queryKey: ['inventory', 'locations'],
    queryFn: () => api.get('/inventory/locations').then((res) => res.data.locations),
  });
}

// { key, kind, name } — new store or station. { key, _id, name?, active? } — rename, close or reopen.
export const useSaveLocation = () =>
  useInventoryMutation(({ key, _id, ...values }) => (_id ? send('patch', `/inventory/locations/${_id}`, key, values) : send('post', '/inventory/locations', key, values)));
