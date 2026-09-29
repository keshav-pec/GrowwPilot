import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Search customers by name or phone (starts after 2 characters)
export function useCustomerSearch(search) {
  return useQuery({
    queryKey: ['customers', 'search', search],
    queryFn: () => api.get('/customers', { params: { search } }).then((res) => res.data.customers),
    enabled: search.trim().length >= 2,
  });
}

export function useCreateCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values) => api.post('/customers', values).then((res) => res.data.customer),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });
}
