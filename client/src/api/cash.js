import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { keyed, useChange } from './request';

// The cash drawer at the selected branch: { today, session, suggestedFloat, cashSoFar, recent, permissions }
export const useCashDay = () => useQuery({ queryKey: ['cash-day'], queryFn: () => api.get('/cash-sessions/current').then((res) => res.data) });

const useCashMutation = (mutationFn) => useChange(mutationFn, ['cash-day']);
const post = (url, key, body) => api.post(url, body, keyed(key)).then((res) => res.data.session);

// { key, openingFloat }
export const useOpenCashDay = () => useCashMutation(({ key, ...body }) => post('/cash-sessions', key, body));
// { _id, key, kind: 'PETTY_IN' | 'PETTY_OUT', amount, reason }
export const useAddPettyCash = () => useCashMutation(({ _id, key, ...body }) => post(`/cash-sessions/${_id}/movements`, key, body));
// { _id, key, countedCash, note, version }
export const useCloseCashDay = () => useCashMutation(({ _id, key, ...body }) => post(`/cash-sessions/${_id}/close`, key, body));
// { _id, key, amount (plus or minus), reason }
export const useAdjustCashDay = () => useCashMutation(({ _id, key, ...body }) => post(`/cash-sessions/${_id}/adjustments`, key, body));
