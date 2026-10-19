import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Settings, ShoppingBag } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useBills } from '../../api/invoices';
import { formatMoney } from '../../lib/money';
import { formatDateTime } from '../../lib/time';
import { useDebounce } from '../../lib/useDebounce';
import { billBadge } from '../../lib/billing';
import { hasAddon } from '../../lib/constants';
import { Badge, Button, EmptyState, Input, PageHeader, Pagination, Select, Table } from '../../components/ui';
import NewSaleModal from './NewSaleModal';

const STATUS_OPTIONS = [
  { value: '', label: 'All bills' },
  { value: 'DUE', label: 'Money still due' },
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'PARTIALLY_PAID', label: 'Part paid' },
  { value: 'PAID', label: 'Paid' },
  { value: 'REFUNDED', label: 'Refunded' },
  { value: 'DRAFT', label: 'Drafts' },
  { value: 'VOID', label: 'Void' },
];

// Every bill at my branches: search by number, customer name or phone; filter by dates, status and branch
export default function BillsListPage() {
  const navigate = useNavigate();
  const { user, activeBranch } = useAuth();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [branchChoice, setBranchChoice] = useState(null); // null = the branch picked in the branch switcher
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [newSale, setNewSale] = useState(false);

  const debouncedSearch = useDebounce(search.trim());
  const branchId = branchChoice ?? activeBranch._id;
  const bills = useBills({ search: debouncedSearch || undefined, status: status || undefined, branchId: branchChoice ?? undefined, from: from || undefined, to: to || undefined, page });
  const isOwner = user.role === 'OWNER';
  const manyBranches = user.branches.length > 1;
  const branchOptions = [...(manyBranches ? [{ value: 'all', label: 'All my branches' }] : []), ...user.branches.map((b) => ({ value: b._id, label: b.name }))];
  const filtered = (setter) => (e) => {
    setter(e.target.value);
    setPage(1);
  };

  const columns = [
    { key: 'number', header: 'Bill', render: (b) => (b.invoiceNumber ? <span className="font-mono">{b.invoiceNumber}</span> : <span className="text-muted">Draft</span>) },
    { key: 'date', header: 'Date', render: (b) => formatDateTime(b.issuedAt ?? b.createdAt, b.branchId.timezone) },
    { key: 'customer', header: 'Customer', render: (b) => b.customerSnapshot?.name ?? 'Guest' },
    ...(branchId === 'all' ? [{ key: 'branch', header: 'Branch', render: (b) => b.branchId.name }] : []),
    { key: 'total', header: 'Total', render: (b) => formatMoney(b.grandTotal) },
    { key: 'paid', header: 'Paid', render: (b) => (b.status === 'DRAFT' ? '—' : formatMoney(b.amountPaid)) },
    { key: 'due', header: 'Due', render: (b) => (b.status !== 'DRAFT' && b.balanceDue > 0 ? <span className="font-medium text-orange">{formatMoney(b.balanceDue)}</span> : '—') },
    {
      key: 'status',
      header: 'Status',
      render: (b) => {
        const badge = billBadge(b);
        return (
          <span className="flex gap-1">
            <Badge tone={badge.tone}>{badge.label}</Badge>
            {b.approval?.status === 'PENDING' && <Badge tone="yellow">Waiting for approval</Badge>}
            {b.refundStatus && b.refundStatus !== 'NONE' && <Badge tone="orange">{b.refundStatus === 'FULL' ? 'Refunded' : 'Part refunded'}</Badge>}
          </span>
        );
      },
    },
  ];

  const totals = bills.data?.totals;
  return (
    <>
      <PageHeader
        title="Bills"
        subtitle="Every bill, with what has been paid and what is still due"
        actions={
          <>
            {isOwner && (
              <Button variant="secondary" onClick={() => navigate('/app/settings/billing')}>
                <Settings size={16} /> Billing settings
              </Button>
            )}
            {hasAddon(user, 'inventory') && (
              <Button onClick={() => setNewSale(true)}>
                <ShoppingBag size={16} /> New sale
              </Button>
            )}
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <div className="lg:col-span-2">
          <Input placeholder="Search bill number, customer or phone" value={search} onChange={filtered(setSearch)} aria-label="Search bills" />
        </div>
        <Select options={STATUS_OPTIONS} value={status} onChange={filtered(setStatus)} aria-label="Status" />
        <Input type="date" value={from} onChange={filtered(setFrom)} aria-label="From date" />
        <Input type="date" value={to} onChange={filtered(setTo)} aria-label="To date" />
        {manyBranches && <Select options={branchOptions} value={branchId} onChange={filtered(setBranchChoice)} aria-label="Branch" />}
      </div>

      {totals && (
        <div className="mb-4 grid grid-cols-3 gap-3 text-sm">
          <Stat label={`Billed (${totals.issued} bill${totals.issued === 1 ? '' : 's'})`} value={formatMoney(totals.billed)} />
          <Stat label="Collected" value={formatMoney(totals.paid)} />
          <Stat label="Still due" value={formatMoney(totals.due)} highlight={totals.due > 0} />
        </div>
      )}

      <Table
        columns={columns}
        rows={bills.data?.rows}
        loading={bills.isPending}
        onRowClick={(b) => navigate(b.status !== 'DRAFT' ? `/app/invoices/${b._id}` : b.appointmentId ? `/app/checkout/${b.appointmentId}` : `/app/bills/${b._id}/edit`)}
        empty={<EmptyState icon={Receipt} title="No bills found" message={search || status || from || to ? 'Try other filters.' : 'Bills appear here when an appointment is checked out.'} />}
      />
      {bills.isError && <p className="mt-2 text-sm text-danger">{bills.error.message}</p>}
      <Pagination page={page} pages={bills.data?.pages ?? 1} onChange={setPage} />
      {newSale && <NewSaleModal onClose={() => setNewSale(false)} />}
    </>
  );
}

function Stat({ label, value, highlight = false }) {
  return (
    <div className="rounded-xl border border-border p-3">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-lg font-semibold ${highlight ? 'text-orange' : 'text-brown'}`}>{value}</p>
    </div>
  );
}
