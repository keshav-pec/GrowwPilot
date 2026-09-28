import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Most screens do the same three things with a resource: list it, save one (create or edit),
// and change its status. These three hooks do that for any URL.

// GET /staff -> res.data.staff
export function useResourceList(queryKey, url, field) {
  return useQuery({
    queryKey,
    queryFn: () => api.get(url).then((res) => res.data[field]),
  });
}

// No _id -> POST /staff (create). With _id -> PATCH /staff/:id (edit).
// `refresh` lists the query keys to reload afterwards.
export function useSaveResource(url, refresh) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ _id, ...values }) =>
      (_id ? api.patch(`${url}/${_id}`, values) : api.post(url, values)).then((res) => res.data),
    onSuccess: () => refresh.forEach((queryKey) => queryClient.invalidateQueries({ queryKey })),
  });
}

// PATCH /staff/:id/status with { status, ...anything else }
export function useSetResourceStatus(url, refresh) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ _id, ...body }) => api.patch(`${url}/${_id}/status`, body).then((res) => res.data),
    onSuccess: () => refresh.forEach((queryKey) => queryClient.invalidateQueries({ queryKey })),
  });
}
