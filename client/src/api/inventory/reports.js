import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../client';

// One report: { title, note, from, to, branches, columns, rows }. params: { from, to, branches }
export function useReport(name, params) {
  return useQuery({
    queryKey: ['inventory', 'report', name, params],
    queryFn: () => api.get(`/inventory/reports/${name}`, { params }).then((res) => res.data),
    placeholderData: keepPreviousData,
  });
}

// Download the CSV. It is built on the server, with costs already removed for people who can't see them.
// Fetched through the API client (not a plain link) so the selected branch goes with it.
export async function downloadReportCsv(name, params) {
  const res = await api.get(`/inventory/reports/${name}`, { params: { ...params, format: 'csv' }, responseType: 'blob' });
  const fileName = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] ?? `${name}.csv`;
  const url = URL.createObjectURL(res.data);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
