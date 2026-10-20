import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { downloadFile } from './download';

// The billing reports: [{ name, label }]
export const useBillingReportList = () => useQuery({ queryKey: ['billing-reports'], queryFn: () => api.get('/billing/reports').then((res) => res.data.reports) });

// One report: { title, note, from, to, branches, columns, rows, totals }. params: { from, to, branches }
export function useBillingReport(name, params, enabled = true) {
  return useQuery({
    queryKey: ['billing-report', name, params],
    queryFn: () => api.get(`/billing/reports/${name}`, { params }).then((res) => res.data),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export const downloadBillingCsv = (name, params) => downloadFile(`/billing/reports/${name}`, { ...params, format: 'csv' }, `${name}.csv`);

// The Dues page: { asOf, total, buckets, customers, rows }. params: { branches, search }
export function useDues(params) {
  return useQuery({ queryKey: ['dues', params], queryFn: () => api.get('/billing/dues', { params }).then((res) => res.data), placeholderData: keepPreviousData });
}

// A customer's money: { totalDue, totalBilled, advanceBalance, bills, payments, refunds }
export function useCustomerMoney(customerId) {
  return useQuery({ queryKey: ['customer-money', customerId], queryFn: () => api.get(`/customers/${customerId}/money`).then((res) => res.data), enabled: Boolean(customerId) });
}
