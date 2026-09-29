import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from './client';

// Screens that show availability refresh every 60 seconds (and when the tab regains focus),
// so a desk sees bookings made by another desk without reloading.
const REFRESH_EVERY = 60_000;

export function useAppointments(filters) {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['appointments', activeBranchId, filters],
    queryFn: () => api.get('/appointments', { params: filters }).then((res) => res.data.appointments),
    refetchInterval: REFRESH_EVERY,
  });
}

export function useAppointment(id) {
  return useQuery({
    queryKey: ['appointment', id],
    queryFn: () => api.get(`/appointments/${id}`).then((res) => res.data.appointment),
    enabled: Boolean(id),
  });
}

// Free start times for a stylist. Only runs once a stylist and date are chosen.
export function useAvailability({ date, staffId, duration, excludeAppointmentId }) {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['availability', activeBranchId, date, staffId, duration, excludeAppointmentId],
    queryFn: () => api.get('/availability', { params: { date, staffId, duration, excludeAppointmentId } }).then((res) => res.data),
    enabled: Boolean(date && staffId && duration),
    refetchInterval: REFRESH_EVERY,
  });
}

// After any change, reload appointment lists, the day board and free times
function useRefreshAppointments() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['appointments'] });
    queryClient.invalidateQueries({ queryKey: ['appointment'] });
    queryClient.invalidateQueries({ queryKey: ['availability'] });
  };
}

// Create (no _id) or edit / reschedule (with _id)
export function useSaveAppointment() {
  const refresh = useRefreshAppointments();
  return useMutation({
    mutationFn: ({ _id, ...values }) =>
      (_id ? api.patch(`/appointments/${_id}`, values) : api.post('/appointments', values)).then((res) => res.data.appointment),
    onSettled: refresh, // also on error: a 409 means our free times are out of date
  });
}

export function useSetAppointmentStatus() {
  const refresh = useRefreshAppointments();
  return useMutation({
    mutationFn: ({ _id, status, reason }) => api.patch(`/appointments/${_id}/status`, { status, reason }).then((res) => res.data.appointment),
    onSettled: refresh,
  });
}
