import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { downloadFile } from './download';

// Birthday & Anniversary Offers

// Settings → Occasion offers (owners): the switch, data counts, consent wording, version
export function useOccasionSettings() {
  return useQuery({ queryKey: ['occasions', 'settings'], queryFn: () => api.get('/occasions/settings').then((res) => res.data) });
}

// { key, version, ...changes }. Switching on or off also refreshes the login session (the sidebar reads it).
export function useSaveOccasionSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, version, ...values }) =>
      api.put('/occasions/settings', values, { headers: { 'Idempotency-Key': key, 'If-Match': `"${version}"` } }).then((res) => res.data),
    onSuccess: (settings) => {
      queryClient.setQueryData(['occasions', 'settings'], settings);
      queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });
}

// A customer's messaging permission: { channels, wording, noticeVersion, can }
export function useConsents(customerId) {
  return useQuery({ queryKey: ['occasions', 'consents', customerId], queryFn: () => api.get(`/occasions/customers/${customerId}/consents`).then((res) => res.data) });
}

export function useConsentHistory(customerId) {
  return useQuery({
    queryKey: ['occasions', 'consents', customerId, 'history'],
    queryFn: () => api.get(`/occasions/customers/${customerId}/consents/history`).then((res) => res.data.events),
  });
}

// Record or withdraw one channel: { key, channel, status, source, agreed, customerAsked, note }
export function useChangeConsent(customerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }) => api.post(`/occasions/customers/${customerId}/consents`, body, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['occasions', 'consents', customerId] }),
  });
}

// Business owner: clear the dates and opt out of every channel. { key, reason }
export function useRemoveOccasionData(customerId) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, reason }) => api.post(`/occasions/customers/${customerId}/remove-data`, { reason }, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['occasions'] });
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
}

export const downloadDatesTemplate = () => downloadFile('/occasions/import/template', undefined, 'customer-occasions.csv');

// { rows, checkOnly, key? } -> { total, toSave, unchanged, rejected, saved }
export function useImportDates() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...body }) => api.post('/occasions/import', body, { headers: key ? { 'Idempotency-Key': key } : {} }).then((res) => res.data),
    onSuccess: (result) => {
      if (result.saved > 0) {
        queryClient.invalidateQueries({ queryKey: ['occasions', 'settings'] });
        queryClient.invalidateQueries({ queryKey: ['customers'] });
      }
    },
  });
}

// ---------------------------------------------------------------------------
// Campaigns (owners)
// ---------------------------------------------------------------------------

// { campaigns, audience, delivery, can }
export function useCampaigns() {
  return useQuery({ queryKey: ['occasions', 'campaigns'], queryFn: () => api.get('/occasions/campaigns').then((res) => res.data) });
}

export function useCampaign(id) {
  return useQuery({ queryKey: ['occasions', 'campaigns', id], queryFn: () => api.get(`/occasions/campaigns/${id}`).then((res) => res.data.campaign), enabled: Boolean(id) });
}

export function useCampaignVersions(id) {
  return useQuery({ queryKey: ['occasions', 'campaigns', id, 'versions'], queryFn: () => api.get(`/occasions/campaigns/${id}/versions`).then((res) => res.data.versions) });
}

// This month's audience as if live: { eligible, canMessage, customers }. Nothing is saved.
export function useCampaignPreview(id, enabled = true) {
  return useQuery({ queryKey: ['occasions', 'campaigns', id, 'preview'], queryFn: () => api.get(`/occasions/campaigns/${id}/preview`).then((res) => res.data), enabled });
}

function useCampaignMutation(request) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['occasions', 'campaigns'] }),
  });
}

const keyed = (key, extra = {}) => ({ headers: { 'Idempotency-Key': key, ...extra } });

// { key, ...campaign } -> { campaign: { _id } }
export const useCreateCampaign = () => useCampaignMutation(({ key, ...body }) => api.post('/occasions/campaigns', body, keyed(key)).then((res) => res.data.campaign));

// { key, id, version, ...changes } -> the campaign
export const useUpdateCampaign = () =>
  useCampaignMutation(({ key, id, version, ...body }) => api.patch(`/occasions/campaigns/${id}`, body, keyed(key, { 'If-Match': `"${version}"` })).then((res) => res.data.campaign));

// { key, id, action: 'publish' | 'disable' | 'enable' | 'archive' | 'discard-draft' } -> the campaign
export const useCampaignAction = () => useCampaignMutation(({ key, id, action }) => api.post(`/occasions/campaigns/${id}/${action}`, null, keyed(key)).then((res) => res.data.campaign));

// Quick setup: the starting suggestions as drafts (only for occasions without a salon-wide campaign)
export const useStarterCampaigns = () => useCampaignMutation(({ key }) => api.post('/occasions/campaigns/starters', null, keyed(key)).then((res) => res.data));

// ---------------------------------------------------------------------------
// The occasion list (front desk and owners)
// ---------------------------------------------------------------------------
const clean = (params) => Object.fromEntries(Object.entries(params).filter(([, v]) => v !== '' && v != null));

// One tab of the list, 50 at a time ("Load more" fetches the next page). filters: { tab, search, type, year, month, canMessage, assignee, branch }
export function useOffers(filters) {
  return useInfiniteQuery({
    queryKey: ['occasions', 'offers', 'list', filters],
    queryFn: ({ pageParam }) => api.get('/occasions/offers', { params: clean({ ...filters, cursor: pageParam }) }).then((res) => res.data),
    initialPageParam: undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

// { year, month, eligible, needsAction, booked, used } for the tiles and the Dashboard / Today widget
export function useOfferSummary(filters = {}, enabled = true) {
  return useQuery({ queryKey: ['occasions', 'offers', 'summary', filters], queryFn: () => api.get('/occasions/offers/summary', { params: clean(filters) }).then((res) => res.data), enabled });
}

// The side drawer: { offer, permission, events }
export function useOffer(id) {
  return useQuery({ queryKey: ['occasions', 'offers', id], queryFn: () => api.get(`/occasions/offers/${id}`).then((res) => res.data), enabled: Boolean(id) });
}

// A customer's offers (this year and last), for their profile
export function useCustomerOffers(customerId) {
  return useQuery({ queryKey: ['occasions', 'customer-offers', customerId], queryFn: () => api.get(`/occasions/customers/${customerId}/offers`).then((res) => res.data.offers) });
}

// "Check now" (business owner)
export function useRunNow() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/occasions/settings/run-now').then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['occasions'] }),
  });
}

// Emergency withdraw (business owner): { key, id, year, reason } -> { revoked, toTell }
export function useRevokeOffers() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, id, year, reason }) => api.post(`/occasions/campaigns/${id}/revoke`, { year, reason }, { headers: { 'Idempotency-Key': key } }).then((res) => res.data),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['occasions'] }),
  });
}

// ---------------------------------------------------------------------------
// Follow-up (Phase 4)
// ---------------------------------------------------------------------------

// Who it goes to, on which channel, and the finished message — or why it can't be sent now
export function useSendPreview(offerId, channel, enabled = true) {
  return useQuery({
    queryKey: ['occasions', 'offers', offerId, 'send-preview', channel ?? null],
    queryFn: () => api.get(`/occasions/offers/${offerId}/send-preview`, { params: channel ? { channel } : {} }).then((res) => res.data),
    enabled,
  });
}

function useOfferMutation(request) {
  const queryClient = useQueryClient();
  return useMutation({ mutationFn: request, onSettled: () => queryClient.invalidateQueries({ queryKey: ['occasions'] }) });
}

// { key, offerId, channel } -> { link, body, subject, channel, to }
export const useSendOffer = () => useOfferMutation(({ key, offerId, channel }) => api.post(`/occasions/offers/${offerId}/send`, { channel }, { headers: { 'Idempotency-Key': key } }).then((res) => res.data));

// { key, offerId, outcome, note?, callbackAt? } -> { outcome, fixDetails }
export const useRecordContact = () =>
  useOfferMutation(({ key, offerId, ...body }) => api.post(`/occasions/offers/${offerId}/contact`, body, { headers: { 'Idempotency-Key': key } }).then((res) => res.data));

export function useAssignees(offerId) {
  return useQuery({ queryKey: ['occasions', 'offers', offerId, 'assignees'], queryFn: () => api.get(`/occasions/offers/${offerId}/assignees`).then((res) => res.data.assignees) });
}

// { key, offerId, assigneeId | null }
export const useAssignOffer = () =>
  useOfferMutation(({ key, offerId, assigneeId }) => api.post(`/occasions/offers/${offerId}/assign`, { assigneeId }, { headers: { 'Idempotency-Key': key } }).then((res) => res.data));

// { key, id, version, WHATSAPP, SMS, EMAIL } -> the campaign
export function useSaveCampaignMessages() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, id, version, ...messages }) =>
      api.put(`/occasions/campaigns/${id}/messages`, messages, { headers: { 'Idempotency-Key': key, 'If-Match': `"${version}"` } }).then((res) => res.data.campaign),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['occasions', 'campaigns'] }),
  });
}

// Offers a customer can still use, with the likely discount on the chosen services (booking box, check-in badge)
export function useLiveOffers(customerId, serviceIds = [], enabled = true) {
  return useQuery({
    queryKey: ['occasions', 'live-offers', customerId, serviceIds.join(',')],
    queryFn: () => api.get(`/occasions/customers/${customerId}/live-offers`, { params: serviceIds.length ? { serviceIds: serviceIds.join(',') } : {} }).then((res) => res.data.offers),
    enabled: Boolean(customerId) && enabled,
  });
}
