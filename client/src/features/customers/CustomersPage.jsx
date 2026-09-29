import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Search, UserPlus, Users } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useCustomers } from '../../api/customers';
import { useDebounce } from '../../lib/useDebounce';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { Button, EmptyState, Input, PageHeader, Pagination, Table } from '../../components/ui';
import CustomerFormModal from './CustomerFormModal';

export default function CustomersPage() {
  const navigate = useNavigate();
  const { activeBranch } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const page = Number(searchParams.get('page')) || 1;

  // Search box -> URL (?search=...) 300 ms after typing stops, and back to page 1
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const debouncedSearch = useDebounce(search);
  useEffect(() => {
    if (debouncedSearch !== (searchParams.get('search') || '')) {
      setSearchParams(debouncedSearch ? { search: debouncedSearch } : {}, { replace: true });
    }
  }, [debouncedSearch]);

  const customersQuery = useCustomers({ search: searchParams.get('search') || '', page });
  const [adding, setAdding] = useState(false);

  function goToPage(newPage) {
    setSearchParams((params) => {
      params.set('page', newPage);
      return params;
    });
  }

  const columns = [
    { key: 'name', header: 'Name', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'phone', header: 'Phone' },
    { key: 'totalVisits', header: 'Visits' },
    { key: 'lastVisitAt', header: 'Last visit', render: (c) => (c.lastVisitAt ? formatDate(c.lastVisitAt, activeBranch.timezone) : '—') },
    { key: 'totalSpend', header: 'Spend', render: (c) => formatMoney(c.totalSpend) },
  ];

  const data = customersQuery.data;

  return (
    <>
      <PageHeader
        title="Customers"
        subtitle={data ? `${data.total} customer${data.total === 1 ? '' : 's'} across all branches` : 'Shared by all your branches'}
        actions={
          <Button onClick={() => setAdding(true)}>
            <UserPlus size={16} /> Add customer
          </Button>
        }
      />

      <div className="relative mb-4 max-w-md">
        <Search size={16} className="absolute left-3 top-2.5 text-muted" />
        <Input placeholder="Search by name or phone" value={search} onChange={(e) => setSearch(e.target.value)} className="pl-9" />
      </div>

      {customersQuery.isError ? (
        <p className="text-sm text-danger">{customersQuery.error.message}</p>
      ) : (
        <>
          <Table
            columns={columns}
            rows={data?.customers}
            loading={customersQuery.isPending}
            onRowClick={(c) => navigate(`/app/customers/${c._id}`)}
            empty={
              <EmptyState
                icon={search ? Search : Users}
                title={search ? 'No customer matches' : 'No customers yet'}
                message={search ? 'Try another name or phone number.' : 'Customers are added when you book, or here.'}
              />
            }
          />
          {data && <Pagination page={data.page} pages={data.pages} onChange={goToPage} />}
        </>
      )}

      {adding && <CustomerFormModal onClose={() => setAdding(false)} onSaved={(c) => navigate(`/app/customers/${c._id}`)} />}
    </>
  );
}
