import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Money changes are sent with an Idempotency-Key (see newRequestKey in lib/billing.js)
const send = (method, url, key, body) =>
  api.request({ method, url, data: body, headers: key ? { 'Idempotency-Key': key } : undefined }).then((res) => res.data.invoice);

// After a bill changes: the bill itself, lists, the day board, customer spend, the dashboard and the bell
function useBillMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (invoice) => {
      if (invoice?._id) queryClient.setQueryData(['invoice', invoice._id], invoice);
      for (const key of ['invoices', 'appointments', 'appointment', 'customers', 'dashboard', 'notifications']) queryClient.invalidateQueries({ queryKey: [key] });
    },
  });
}

export function useInvoice(id) {
  return useQuery({
    queryKey: ['invoice', id],
    queryFn: () => api.get(`/invoices/${id}`).then((res) => res.data.invoice),
    enabled: Boolean(id),
  });
}

// Bills list: { search, status, branchId, from, to, page } -> { rows, page, pages, total, totals }
export function useBills(params) {
  return useQuery({
    queryKey: ['invoices', params],
    queryFn: () => api.get('/invoices', { params }).then((res) => res.data),
    placeholderData: keepPreviousData,
  });
}

// Opens (or makes) the draft bill for a finished appointment. Safe to repeat.
export const useOpenDraft = () => useBillMutation(({ appointmentId }) => send('post', '/invoices', null, { appointmentId }));

// Live prices for unsaved changes, worked out by the server (nothing is saved)
export function useQuote(id, edits, enabled) {
  return useQuery({
    queryKey: ['invoice-quote', id, edits],
    queryFn: () => send('post', `/invoices/${id}/quote`, null, edits),
    enabled: Boolean(id) && enabled,
    placeholderData: keepPreviousData,
    retry: false,
    staleTime: 0,
  });
}

// { _id, version, billDiscount?, lines? }
export const useSaveDraft = () => useBillMutation(({ _id, ...body }) => send('patch', `/invoices/${_id}`, null, body));
// { _id, key, version, payments, billDiscount?, lines? }
export const useIssueInvoice = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/issue`, key, body));
// { _id, key, version, note, billDiscount?, lines? }
export const useRequestApproval = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/request-approval`, key, body));
// { _id, key, version, note? }
export const useApproveDiscount = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/approve`, key, body));
export const useRejectDiscount = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/reject`, key, body));
// { key, invoiceId, payments }
export const useRecordPayment = () => useBillMutation(({ key, ...body }) => send('post', '/payments', key, body));
