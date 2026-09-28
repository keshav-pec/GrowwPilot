import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// React Query hooks for the Super Admin screens

export function useOrgs(filters) {
  return useQuery({
    queryKey: ['admin', 'orgs', filters],
    queryFn: () => api.get('/admin/orgs', { params: filters }).then((res) => res.data.orgs),
  });
}

export function useOrg(id) {
  return useQuery({
    queryKey: ['admin', 'org', id],
    queryFn: () => api.get(`/admin/orgs/${id}`).then((res) => res.data.org),
  });
}

export function useCreateOrg() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values) => api.post('/admin/orgs', values).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }), // refresh the salon list
  });
}

export function useSetOrgStatus(id) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (status) => api.patch(`/admin/orgs/${id}/status`, { status }).then((res) => res.data.org),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['admin'] }),
  });
}
