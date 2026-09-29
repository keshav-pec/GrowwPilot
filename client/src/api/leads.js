import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../auth/AuthContext';
import { api } from './client';

export function useLeads(filters) {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['leads', activeBranchId, filters],
    queryFn: () => api.get('/leads', { params: filters }).then((res) => res.data.leads),
  });
}

// { lead, matchingCustomer }
export function useLead(id) {
  return useQuery({
    queryKey: ['lead', id],
    queryFn: () => api.get(`/leads/${id}`).then((res) => res.data),
    enabled: Boolean(id),
  });
}

// Who a lead can be assigned to at this branch
export function useAssignees() {
  const { activeBranchId } = useAuth();
  return useQuery({
    queryKey: ['lead-assignees', activeBranchId],
    queryFn: () => api.get('/leads/assignees').then((res) => res.data.users),
  });
}

function useRefreshLeads() {
  const queryClient = useQueryClient();
  return () => {
    queryClient.invalidateQueries({ queryKey: ['leads'] });
    queryClient.invalidateQueries({ queryKey: ['lead'] });
  };
}

// Create (no _id) or edit (with _id)
export function useSaveLead() {
  const refresh = useRefreshLeads();
  return useMutation({
    mutationFn: ({ _id, ...values }) => (_id ? api.patch(`/leads/${_id}`, values) : api.post('/leads', values)).then((res) => res.data.lead),
    onSuccess: refresh,
  });
}

export function useSetLeadStatus() {
  const refresh = useRefreshLeads();
  return useMutation({
    mutationFn: ({ _id, status }) => api.patch(`/leads/${_id}/status`, { status }).then((res) => res.data.lead),
    onSuccess: refresh,
  });
}

export function useAddLeadNote() {
  const refresh = useRefreshLeads();
  return useMutation({
    mutationFn: ({ _id, text }) => api.post(`/leads/${_id}/notes`, { text }).then((res) => res.data.lead),
    onSuccess: refresh,
  });
}

// Convert: books the appointment and closes the lead in one go
export function useConvertLead() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ _id, ...booking }) => api.post(`/leads/${_id}/convert`, booking).then((res) => res.data),
    onSettled: () => {
      for (const key of ['leads', 'lead', 'appointments', 'availability', 'customers']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}
