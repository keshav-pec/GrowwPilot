import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export function useInvoice(id) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((res) => res.data.invoice),
    enabled: Boolean(id),
  });
}

// { appointmentId, discountType, discountValue, payments }
export function useCreateInvoice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values) => api.post('/invoices', values).then((res) => res.data.invoice),
    onSettled: () => {
      // The appointment is now paid, and the customer's spend changed
      for (const key of ['appointments', 'appointment', 'customers']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}
