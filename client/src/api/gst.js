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

// A sample bill, worked out by the server. Nothing is saved.
export function useTestBill() {
  return useMutation({ mutationFn: (body) => send('post', '/gst/test-bill', null, body) });
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

// Advances for named services: { columns, rows, totals, byGstin, plainLeft }. params: { gstin, open }
export function useGstAdvances(params) {
  return useQuery({ queryKey: ['gst-advances', params], queryFn: () => api.get('/gst/advances', { params }).then((res) => res.data), placeholderData: keepPreviousData });
}
export const downloadGstAdvances = (params) => downloadFile('/gst/advances', { ...params, format: 'csv' }, 'gst-advances.csv');

// Compares bills with the tax record now, as the night timer does
export function useRunGstCheck() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ key }) => send('post', '/gst/check', key),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['gst-overview'] }),
  });
}

// ---- GSTR-1 ----
const RETURN_KEYS = ['gst-returns', 'gst-return', 'gst-overview', 'gst-purchases', 'gst-worksheet'];
function useReturnChange(request) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: request,
    onSuccess: () => RETURN_KEYS.forEach((name) => queryClient.invalidateQueries({ queryKey: [name] })),
  });
}

// Months of a GSTIN: { active, gstins, gstin, canWork, months: [{ period, returnId, revision, status, taxable, tax, arn, toFix }] }
export function useGstReturns(params) {
  return useQuery({ queryKey: ['gst-returns', params], queryFn: () => api.get('/gst/returns', { params }).then((res) => res.data), placeholderData: keepPreviousData });
}
export function useGstReturn(id) {
  return useQuery({ queryKey: ['gst-return', id], queryFn: () => api.get(`/gst/returns/${id}`).then((res) => res.data), enabled: Boolean(id) });
}
// The entries behind one figure
export function useReturnTrail(id, row) {
  return useQuery({ queryKey: ['gst-return-trail', id, row], queryFn: () => api.get(`/gst/returns/${id}/trail`, { params: { row } }).then((res) => res.data), enabled: Boolean(row) });
}
export const usePrepareReturn = () => useReturnChange(({ key, ...body }) => send('post', '/gst/returns', key, body));
export const useApproveReturn = () => useReturnChange(({ key, _id }) => send('post', `/gst/returns/${_id}/approve`, key));
export const useRejectReturn = () => useReturnChange(({ key, _id, text }) => send('post', `/gst/returns/${_id}/reject`, key, { text }));
export const useCreateAdjustment = () => useReturnChange(({ key, _id, ...body }) => send('post', `/gst/returns/${_id}/adjustments`, key, body));

// Filing needs its proof, so it goes as a form. path: `returns/<id>`, `adjustments/<id>` or `worksheets/<id>`
export const useRecordFiling = () =>
  useReturnChange(({ key, path, arn, filedOn, proof }) => {
    const form = new FormData();
    form.append('arn', arn);
    form.append('filedOn', filedOn);
    if (proof) form.append('proof', proof);
    return send('post', `/gst/${path}/file`, key, form);
  });

// The file for the GST portal. Downloading it marks the revision Exported, never Filed.
export const useExportFile = () =>
  useReturnChange(async ({ path }) => {
    const res = await api.post(`/gst/${path}/export`, null, { responseType: 'blob' });
    const fileName = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] ?? 'GSTR1.json';
    const link = document.createElement('a');
    link.href = URL.createObjectURL(res.data);
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(link.href);
  });
export const downloadReview = (id, kind) => downloadFile(`/gst/returns/${id}/review.${kind}`, {}, `GSTR1-review.${kind}`);
export const downloadProof = (proofId, name) => downloadFile(`/gst/proofs/${proofId}`, {}, name ?? 'proof');

export const useSaveUnits = () => useGstChange((body) => ['patch', '/gst/units', body]);

// ---- Purchases & ITC ----
// { gstins, gstin, period, rows, imported, summary, canWork, locked }. params: { gstin, period }
export function useGstPurchases(params) {
  return useQuery({ queryKey: ['gst-purchases', params], queryFn: () => api.get('/gst/purchases', { params }).then((res) => res.data), placeholderData: keepPreviousData });
}
export const useAddPurchase = () => useReturnChange(({ key, ...body }) => send('post', '/gst/purchases', key, body));
export const useCancelPurchase = () => useReturnChange(({ key, _id, reason }) => send('post', `/gst/purchases/${_id}/cancel`, key, { reason }));
export const useDecideItc = () => useReturnChange(({ key, _id, ...body }) => send('post', `/gst/purchases/${_id}/decision`, key, body));
export const useDecideMissing = () => useReturnChange(({ key, ...body }) => send('post', '/gst/purchases/not-claimed', key, body));
export const useImport2b = () =>
  useReturnChange(({ key, gstin, period, file }) => {
    const form = new FormData();
    form.append('gstin', gstin);
    form.append('period', period);
    form.append('file', file);
    return send('post', '/gst/purchases/import-2b', key, form);
  });

// ---- GSTR-3B working sheet ----
export function useGstWorksheet(id) {
  return useQuery({ queryKey: ['gst-worksheet', id], queryFn: () => api.get(`/gst/worksheets/${id}`).then((res) => res.data), enabled: Boolean(id) });
}
export function useWorksheetTrail(id, row) {
  return useQuery({ queryKey: ['gst-worksheet-trail', id, row], queryFn: () => api.get(`/gst/worksheets/${id}/trail`, { params: { row } }).then((res) => res.data), enabled: Boolean(row) });
}
export const usePrepareWorksheet = () => useReturnChange(({ key, ...body }) => send('post', '/gst/worksheets', key, body));
export const useSavePortalFigures = () => useReturnChange(({ key, _id, rows }) => send('put', `/gst/worksheets/${_id}/portal`, key, { rows }));
export const useApproveWorksheet = () => useReturnChange(({ key, _id, ...body }) => send('post', `/gst/worksheets/${_id}/approve`, key, body));
