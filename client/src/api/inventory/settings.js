import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

// { frontDesk, limits, branchOwnerSeesCosts, canChangeOwnerRules }
export function useInventorySettings(enabled = true) {
  return useQuery({ queryKey: ['inventory', 'settings'], queryFn: () => api.get('/inventory/settings').then((res) => res.data), enabled });
}

// { key, frontDesk?, limits?, branchOwnerSeesCosts? }
export const useSaveInventorySettings = () => useInventoryMutation(({ key, ...values }) => send('patch', '/inventory/settings', key, values));

// Rebuild every balance from the movement history: { ok, mismatches, checkedAt }
export const fetchStockCheck = () => api.get('/inventory/settings/check').then((res) => res.data);
