import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Customers page: one page of results, with visits / spend on each row
export function useCustomers({ search, page }) {
  return useQuery({
    queryKey: ['customers', 'list', search, page],
    queryFn: () => api.get('/customers', { params: { search: search || undefined, page } }).then((res) => res.data),
    placeholderData: (previous) => previous, // keep showing the old page while the next one loads
  });
}

// Booking form search box (starts after 2 characters)
export function useCustomerSearch(search) {
  return useQuery({
    queryKey: ['customers', 'search', search],
    queryFn: () => api.get('/customers', { params: { search } }).then((res) => res.data.customers),
    enabled: search.trim().length >= 2,
  });
}

// Profile: { customer, stats, upcoming, past }
export function useCustomerProfile(id) {
  return useQuery({
    queryKey: ['customers', 'profile', id],
    queryFn: () => api.get(`/customers/${id}`).then((res) => res.data),
    enabled: Boolean(id),
  });
}

// Create (no _id) or edit (with _id)
export function useSaveCustomer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ _id, ...values }) =>
      (_id ? api.patch(`/customers/${_id}`, values) : api.post('/customers', values)).then((res) => res.data.customer),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customers'] }),
  });
}

// Used by the booking form's "New customer"
export const useCreateCustomer = useSaveCustomer;
