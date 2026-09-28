import { useAuth } from '../auth/AuthContext';
import { useResourceList, useSaveResource, useSetResourceStatus } from './resource';

// The server returns the staff of the branch picked in the branch switcher,
// so the branch is part of the cache key.
export function useStaff() {
  const { activeBranchId } = useAuth();
  return useResourceList(['staff', activeBranchId], '/staff', 'staff');
}

export const useSaveStaff = () => useSaveResource('/staff', [['staff']]);
export const useSetStaffStatus = () => useSetResourceStatus('/staff', [['staff']]);
