import { useAuth } from '../auth/AuthContext';
import { useResourceList, useSaveResource, useSetResourceStatus } from './resource';

// The server returns the staff of the branch picked in the branch switcher,
// so the branch is part of the cache key.
export function useStaff() {
  const { activeBranchId } = useAuth();
  return useResourceList(['staff', activeBranchId], '/staff', 'staff');
}

// Stylists only (front desk members are never booked or picked as a stylist)
export const isServiceStaff = (s) => s.kind !== 'FRONT_DESK';
export function useServiceStaff() {
  const { activeBranchId } = useAuth();
  return useResourceList(['staff', activeBranchId], '/staff', 'staff', { select: (list) => list.filter(isServiceStaff) });
}

export const useSaveStaff = () => useSaveResource('/staff', [['staff']]);
export const useSetStaffStatus = () => useSetResourceStatus('/staff', [['staff']]);
