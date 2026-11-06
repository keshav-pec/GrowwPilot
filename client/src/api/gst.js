import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { downloadFile } from './download';
import { send } from './request';

// The reason to show for a refused change: the field's own message when the server checked the form, otherwise its message
export const refusalText = (err) => (Array.isArray(err.details) && err.details[0]?.message) || err.message;

// GST setup (owners): registration type, dated registrations, tax rules, test bills, activation
export function useGstSetup() {
  return useQuery({ queryKey: ['gst-setup'], queryFn: () => api.get('/gst/setup').then((res) => res.data) });
}

// For the service and product forms: { active, groups: [{ groupId, name, kind, current }] }
export function useGstRules(enabled = true) {
  return useQuery({ queryKey: ['gst-rules'], queryFn: () => api.get('/gst/rules').then((res) => res.data), enabled });
}

// Each change answers with the whole setup screen. { key, ...body } is what the caller passes.
function useGstChange(request) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key, ...input }) => {
      const [method, url, body] = request(input);
      return send(method, url, key, body);
    },
    onSuccess: ({ setup }) => {
      queryClient.setQueryData(['gst-setup'], setup);
      for (const name of ['gst-rules', 'gst-overview', 'gst-register', 'billing-settings', 'services', 'inventory']) queryClient.invalidateQueries({ queryKey: [name] });
    },
  });
}

export const useSaveGstSetup = () => useGstChange((body) => ['patch', '/gst/setup', body]);
export const useAddRegistration = () => useGstChange((body) => ['post', '/gst/registrations', body]);
export const useLinkBranch = () => useGstChange(({ registrationId, ...body }) => ['post', `/gst/registrations/${registrationId}/branches`, body]);
export const useSaveRule = () => useGstChange(({ _id, ...body }) => (_id ? ['patch', `/gst/rules/${_id}`, body] : ['post', '/gst/rules', body]));
export const useDeleteRule = () => useGstChange(({ _id }) => ['delete', `/gst/rules/${_id}`]);
export const useApproveRule = () => useGstChange(({ _id, ...body }) => ['post', `/gst/rules/${_id}/approve`, body]);
export const useLinkUnlinked = () => useGstChange(({ groupId }) => ['post', `/gst/rule-groups/${groupId}/link-unlinked`]);
export const useActivateGst = () => useGstChange(() => ['post', '/gst/activate']);

// A sample bill, worked out by the server. Trying one also ticks that step, so the checks reload.
export function useTestBill() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body) => send('post', '/gst/test-bill', null, body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gst-setup'] }),
  });
}

// The first screen: { active, month, gstins, net, bills, creditNotes, voided, check, setupProblems }. params: { month, gstin }
export function useGstOverview(params, enabled = true) {
  return useQuery({ queryKey: ['gst-overview', params], queryFn: () => api.get('/gst/overview', { params }).then((res) => res.data), placeholderData: keepPreviousData, enabled });
}

// The sales register: { columns, rows, totals, page, pages, total }. params: { month, gstin, type, search, page }
export function useGstRegister(params) {
  return useQuery({ queryKey: ['gst-register', params], queryFn: () => api.get('/gst/register', { params }).then((res) => res.data), placeholderData: keepPreviousData });
}
export const downloadGstRegister = (params) => downloadFile('/gst/register', { ...params, format: 'csv' }, 'sales-register.csv');

// Compares bills with the tax record now, as the night timer does
export function useRunGstCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key }) => send('post', '/gst/check', key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gst-overview'] }),
  });
}
