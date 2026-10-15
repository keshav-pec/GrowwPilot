import { useQuery } from '@tanstack/react-query';
import { api } from '../client';

// What I may do in Inventory at the selected branch: { branchId, role, can: { 'inventory.issue': true, ... } }.
// The server checks every action again; this only decides which buttons to show.
export function useInventoryAccess() {
  return useQuery({
    queryKey: ['inventory', 'access'],
    queryFn: () => api.get('/inventory/access').then((res) => res.data),
  });
}
