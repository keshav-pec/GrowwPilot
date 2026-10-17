import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { send, useInventoryMutation } from './request';

const P = '/inventory/purchasing';

export function useOrders(status) {
  return useQuery({
    queryKey: ['inventory', 'orders', status ?? 'all'],
    queryFn: () => api.get(`${P}/orders`, { params: { status } }).then((res) => res.data.orders),
  });
}

// { order, receipts, can: { edit, approve, receive, acceptMore } }
export function useOrder(id) {
  return useQuery({
    queryKey: ['inventory', 'order', id],
    queryFn: () => api.get(`${P}/orders/${id}`).then((res) => res.data),
    enabled: Boolean(id),
  });
}

export function useReceipts() {
  return useQuery({ queryKey: ['inventory', 'receipts'], queryFn: () => api.get(`${P}/receipts`).then((res) => res.data.receipts) });
}

export function useSuggestions(enabled = true) {
  return useQuery({ queryKey: ['inventory', 'suggestions'], queryFn: () => api.get(`${P}/suggestions`).then((res) => res.data.suggestions), enabled });
}

// { key, supplierId, lines, expectedDate?, note? } new, or { key, _id, version, ...changes }
export const useSaveOrder = () =>
  useInventoryMutation(({ key, _id, ...values }) => (_id ? send('patch', `${P}/orders/${_id}`, key, values) : send('post', `${P}/orders`, key, values)));

// step: 'submit' | 'decide' | 'order' | 'cancel' | 'close' | 'receive'. { key, id, step, ...body }
export const useOrderStep = () => useInventoryMutation(({ key, id, step, ...body }) => send('post', `${P}/orders/${id}/${step}`, key, body));

export const useDirectReceipt = () => useInventoryMutation(({ key, ...values }) => send('post', `${P}/receipts`, key, values));
export const useReturnToSupplier = () => useInventoryMutation(({ key, ...values }) => send('post', `${P}/returns`, key, values));
export const useOrdersFromSuggestions = () => useInventoryMutation(({ key, lines }) => send('post', `${P}/suggestions/orders`, key, { lines }));
