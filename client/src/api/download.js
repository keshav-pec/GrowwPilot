import { api } from './client';

// Downloads a file the server builds (CSV, PDF). Fetched through the API client, not a plain link,
// so the selected branch goes with it.
export async function downloadFile(url, params, fallbackName) {
  const res = await api.get(url, { params, responseType: 'blob' });
  const fileName = res.headers['content-disposition']?.match(/filename="(.+)"/)?.[1] ?? fallbackName;
  const link = document.createElement('a');
  link.href = URL.createObjectURL(res.data);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}
