import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from './client';

// { today, rows: [{ staff, current, upcoming, pendingRequest }] } for the selected branch
export function useStaffPayList() {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['pay-staff', activeBranchId],
    queryFn: () => api.get('/payroll/staff').then((res) => res.data),
  });
}

// { staff, today, current, upcoming, history (owners only), requests }
export function useStaffPay(staffId) {
  return useQuery({
    queryKey: ['pay-staff-detail', staffId],
    queryFn: () => api.get(`/payroll/staff/${staffId}`).then((res) => res.data),
    enabled: Boolean(staffId),
  });
}

// Owners: one person's commission in a month ("2026-10") -> { entries, count, totalSales, totalAmount }
export function useStaffCommission(staffId, month) {
  return useQuery({
    queryKey: ['pay-commission', staffId, month],
    queryFn: () => api.get(`/payroll/staff/${staffId}/commission`, { params: { month } }).then((res) => res.data),
    enabled: Boolean(staffId && month),
    placeholderData: keepPreviousData,
  });
}

// status: 'pending' or 'all'. Covers every branch the user may use.
export function usePayRequests(status) {
  return useQuery({
    queryKey: ['pay-requests', status],
    queryFn: () => api.get('/payroll/requests', { params: { status } }).then((res) => res.data.requests),
  });
}

export function useActivity(page) {
  return useQuery({
    queryKey: ['activity', page],
    queryFn: () => api.get('/activity', { params: { page } }).then((res) => res.data),
    placeholderData: keepPreviousData, // keep the old page on screen while the next one loads
  });
}

// Any pay change can affect every payroll screen and the bell, so reload them all
function usePayMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values) => mutationFn(values).then((res) => res.data),
    onSuccess: () => {
      for (const key of ['pay-staff', 'pay-staff-detail', 'pay-commission', 'pay-requests', 'activity', 'notifications']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    },
  });
}

// Owners. With planId: edit an upcoming change. Without: add a new pay setup for staffId.
export const useSavePayPlan = () =>
  usePayMutation(({ planId, staffId, ...values }) =>
    planId ? api.patch(`/payroll/plans/${planId}`, values) : api.post(`/payroll/staff/${staffId}/plans`, values)
  );

export const useCancelPayPlan = () => usePayMutation((planId) => api.delete(`/payroll/plans/${planId}`));

export const useEndPayPlan = () => usePayMutation(({ planId, effectiveTo }) => api.post(`/payroll/plans/${planId}/end`, { effectiveTo }));

// Owners: a special commission rate for one service (rateBps: 1500 = 15%), or remove it
export const useSetServiceRate = () =>
  usePayMutation(({ staffId, serviceId, rateBps }) => api.put(`/payroll/staff/${staffId}/service-rates/${serviceId}`, { rateBps }));

export const useRemoveServiceRate = () =>
  usePayMutation(({ staffId, serviceId }) => api.delete(`/payroll/staff/${staffId}/service-rates/${serviceId}`));

// Front desk
export const useRequestPayChange = () => usePayMutation((values) => api.post('/payroll/requests', values));

// action: 'approve' | 'reject' (owners) or 'cancel' (the front desk person who asked)
export const useAnswerPayRequest = () =>
  usePayMutation(({ id, action, note }) => api.post(`/payroll/requests/${id}/${action}`, note ? { note } : {}));
