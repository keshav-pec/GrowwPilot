import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from './client';

// { date, timezone, rows: [{ staff, attendance }] } for the selected branch
export function useAttendance(date) {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['attendance', activeBranchId, date],
    queryFn: () => api.get('/attendance', { params: { date } }).then((res) => res.data),
    enabled: Boolean(date),
  });
}

// { staffId, date, status, checkIn?, checkOut? } -> { attendance, affectedBookings }
export function useMarkAttendance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values) => api.put('/attendance', values).then((res) => res.data),
    onSuccess: () => {
      // Absent stylists disappear from free times and the booking form
      for (const key of ['attendance', 'attendance-summary', 'availability']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useAttendanceSummary(month) {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['attendance-summary', activeBranchId, month],
    queryFn: () => api.get('/attendance/summary', { params: { month } }).then((res) => res.data),
    enabled: Boolean(month),
  });
}
