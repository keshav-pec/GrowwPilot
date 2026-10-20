import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { downloadFile } from './download';

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
      for (const key of ['invoices', 'invoice', 'appointments', 'appointment', 'customers', 'advances', 'dashboard', 'notifications', 'inventory', 'sellable-products']) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
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
// "New sale" (products only): { customerId } (null = Guest)
export const useCreateSale = () => useBillMutation(({ customerId }) => send('post', '/invoices/sale', null, { customerId }));

// Products that can be sold at the selected branch: { rows, exactMatchId }
export function useSellableProducts(search, enabled = true) {
  return useQuery({
    queryKey: ['sellable-products', search],
    queryFn: () => api.get('/invoices/products', { params: { search: search || undefined } }).then((res) => res.data),
    enabled,
    placeholderData: keepPreviousData,
  });
}
// { _id, version, skuId, qty }
export const useAddProduct = () => useBillMutation(({ _id, ...body }) => send('post', `/invoices/${_id}/products`, null, body));
// { _id, version, lineId }
export const useRemoveLine = () => useBillMutation(({ _id, lineId, version }) => send('delete', `/invoices/${_id}/lines/${lineId}?version=${version}`));
// { _id, version }
export function useDiscardDraft() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ _id, version }) => api.delete(`/invoices/${_id}`, { params: { version } }).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['invoices'] }),
  });
}
// { _id, key, reason }
export const useVoidInvoice = () => useBillMutation(({ _id, key, reason }) => send('post', `/invoices/${_id}/void`, key, { reason }));
// { paymentId, key, reason } -> the bill (or null for an advance)
export const useReversePayment = () =>
  useBillMutation(({ paymentId, key, reason }) => api.post(`/payments/${paymentId}/reverse`, { reason }, { headers: { 'Idempotency-Key': key } }).then((res) => res.data.invoice));

// { _id, key, version, payments, useAdvance?, keepExtraAsAdvance?, billDiscount?, lines? }
export const useIssueInvoice = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/issue`, key, body));
// { _id, key, version, note, billDiscount?, lines? }
export const useRequestApproval = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/request-approval`, key, body));
// { _id, key, version, note? }
export const useApproveDiscount = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/approve`, key, body));
export const useRejectDiscount = () => useBillMutation(({ _id, key, ...body }) => send('post', `/invoices/${_id}/reject`, key, body));
// { key, invoiceId, payments, useAdvance?, keepExtraAsAdvance? }
export const useRecordPayment = () => useBillMutation(({ key, ...body }) => send('post', '/payments', key, body));

// What was done to a bill, oldest first: { items: [{ action, summary, actorName, actorRole, createdAt }] }
export function useInvoiceHistory(id, enabled) {
  return useQuery({ queryKey: ['invoice-history', id], queryFn: () => api.get(`/invoices/${id}/history`).then((res) => res.data.items), enabled });
}

export const downloadInvoicePdf = (invoice) => downloadFile(`/invoices/${invoice._id}/pdf`, {}, 'bill.pdf');

// A link the customer can open without logging in: { token, days, phone }
export const useShareInvoice = () => useMutation({ mutationFn: (id) => api.post(`/invoices/${id}/share`).then((res) => res.data) });
