import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Wallet } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useDues } from '../../api/billingReports';
import { formatMoney } from '../../lib/money';
import { formatDay } from '../../lib/time';
import { useDebounce } from '../../lib/useDebounce';
import { EmptyState, Input, PageHeader, Select, Spinner, Table, Tabs } from '../../components/ui';

// Money customers still owe: by age (0–30, 31–60, 61–90, over 90 days), per customer and per bill.
// Click a bill to take the payment.
export default function DuesPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [branches, setBranches] = useState('current');
  const [search, setSearch] = useState('');
  const [tab, setTab] = useState('bills');
  const debounced = useDebounce(search.trim());
  const dues = useDues({ branches, search: debounced || undefined });

  if (dues.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (dues.isError) return <EmptyState title="Couldn’t load dues" message={dues.error.message} />;
  const data = dues.data;

  return (
    <>
      <PageHeader title="Dues" subtitle={`Money customers still owe · as of ${formatDay(data.asOf)}`} />
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <div className="rounded-xl border border-border p-3">
          <p className="text-xs text-muted">Total due</p>
          <p className="text-lg font-semibold text-orange">{formatMoney(data.total)}</p>
        </div>
        {data.buckets.map((b) => (
          <div key={b.label} className="rounded-xl border border-border p-3">
            <p className="text-xs text-muted">{b.label}</p>
            <p className={`text-lg font-semibold ${b.label === 'Over 90 days' && b.due > 0 ? 'text-danger' : 'text-brown'}`}>{formatMoney(b.due)}</p>
            <p className="text-xs text-muted">{b.bills} bill{b.bills === 1 ? '' : 's'}</p>
          </div>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap gap-3">
        <div className="w-full sm:w-72">
          <Input placeholder="Search customer, phone or bill" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search dues" />
        </div>
        {user.branches.length > 1 && (
          <div className="w-48">
            <Select aria-label="Branches" options={[{ value: 'current', label: 'This branch' }, { value: 'all', label: 'All my branches' }]} value={branches} onChange={(e) => setBranches(e.target.value)} />
          </div>
        )}
      </div>

      <Tabs tabs={[{ value: 'bills', label: `Bills (${data.rows.length})` }, { value: 'customers', label: `Customers (${data.customers.length})` }]} value={tab} onChange={setTab} />
      {tab === 'bills' ? (
        <Table
          rows={data.rows}
          onRowClick={(r) => navigate(`/app/invoices/${r._id}`)}
          columns={[
            { key: 'invoiceNumber', header: 'Bill', render: (r) => <span className="font-mono">{r.invoiceNumber}</span> },
            { key: 'day', header: 'Issued', render: (r) => formatDay(r.day) },
            { key: 'customer', header: 'Customer', render: (r) => `${r.customer}${r.phone ? ` · ${r.phone}` : ''}` },
            ...(branches === 'all' ? [{ key: 'branch', header: 'Branch' }] : []),
            { key: 'billed', header: 'Bill', render: (r) => formatMoney(r.billed) },
            { key: 'due', header: 'Due', render: (r) => <span className="font-medium text-orange">{formatMoney(r.due)}</span> },
            { key: 'age', header: 'Age', render: (r) => <span className={r.age > 90 ? 'text-danger' : ''}>{r.age} days</span> },
          ]}
          empty={<EmptyState icon={Wallet} title="Nothing is owed" message="Every issued bill is fully paid." />}
        />
      ) : (
        <Table
          rowKey="customer"
          rows={data.customers}
          onRowClick={(c) => c.customerId && navigate(`/app/customers/${c.customerId}`)}
          columns={[
            { key: 'customer', header: 'Customer', render: (c) => `${c.customer}${c.phone ? ` · ${c.phone}` : ''}` },
            { key: 'bills', header: 'Bills' },
            { key: 'due', header: 'Due', render: (c) => <span className="font-medium text-orange">{formatMoney(c.due)}</span> },
            { key: 'oldest', header: 'Oldest', render: (c) => `${c.oldest} days` },
          ]}
          empty={<EmptyState icon={Wallet} title="Nothing is owed" />}
        />
      )}
    </>
  );
}
