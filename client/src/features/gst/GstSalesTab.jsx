import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Download } from 'lucide-react';
import { downloadGstRegister, useGstOverview, useGstRegister } from '../../api/gst';
import { formatMoney } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { useDebounce } from '../../lib/useDebounce';
import { Badge, Button, EmptyState, Input, Pagination, Select, Table } from '../../components/ui';

const TYPES = [
  { value: '', label: 'Everything' },
  { value: 'BILL_ISSUED', label: 'Bills' },
  { value: 'CREDIT_NOTE', label: 'Credit notes' },
  { value: 'BILL_VOIDED', label: 'Voided bills' },
];
const TYPE_TONE = { Bill: 'neutral', 'Credit note': 'orange', 'Voided bill': 'danger' };

// The sales register: every entry of the tax record for a month. A row opens its bill.
export default function GstSalesTab({ today }) {
  const navigate = useNavigate();
  const [month, setMonth] = useState(today.slice(0, 7));
  const [gstin, setGstin] = useState('');
  const [type, setType] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const typed = useDebounce(search, 300);
  const filters = { month: month || undefined, gstin: gstin || undefined, type: type || undefined, search: typed || undefined };
  const register = useGstRegister({ ...filters, page });
  const gstins = useGstOverview({ month: month || undefined }).data?.gstins ?? [];
  const changing = (set) => (e) => {
    set(e.target.value);
    setPage(1);
  };
  const data = register.data;
  const money = (key, label) => ({ key, header: label, render: (r) => <span className={r[key] < 0 ? 'text-orange' : ''}>{formatMoney(r[key])}</span> });

  const columns = [
    { key: 'taxDate', header: 'Date', render: (r) => formatDate(r.taxDate) },
    { key: 'type', header: 'Type', render: (r) => <Badge tone={TYPE_TONE[r.type]}>{r.type}</Badge> },
    {
      key: 'documentNumber',
      header: 'Number',
      render: (r) => (
        <div>
          <p className="font-mono text-xs">{r.documentNumber}</p>
          <p className="text-xs text-muted">{r.branch}</p>
        </div>
      ),
    },
    {
      key: 'customer',
      header: 'Customer',
      render: (r) => (
        <div>
          <p>{r.customer}</p>
          {r.buyerGstin && <p className="font-mono text-xs text-muted">{r.buyerGstin}</p>}
          {r.place && <p className="text-xs text-muted">Place of supply: {r.place}</p>}
        </div>
      ),
    },
    money('taxable', 'Taxable'),
    money('cgst', 'CGST'),
    money('sgst', 'SGST'),
    money('igst', 'IGST'),
    money('total', 'Total'),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end gap-4">
        <Input label="Month" type="month" value={month} onChange={changing(setMonth)} />
        <div className="min-w-64">
          <Select label="GSTIN" options={[{ value: '', label: 'All GSTINs' }, ...gstins.map((g) => ({ value: g.gstin, label: g.gstin }))]} value={gstin} onChange={changing(setGstin)} />
        </div>
        <Select label="Show" options={TYPES} value={type} onChange={changing(setType)} />
        <Input label="Search" placeholder="Number, customer or GSTIN" value={search} onChange={changing(setSearch)} />
        <Button variant="secondary" disabled={!data?.total} onClick={() => downloadGstRegister(filters).catch((err) => toast.error(err.message))}>
          <Download size={16} /> CSV
        </Button>
      </div>

      {register.isError ? (
        <EmptyState title="Couldn’t load the register" message={register.error.message} />
      ) : (
        <Table columns={columns} rows={data?.rows} loading={register.isPending} onRowClick={(r) => navigate(`/app/invoices/${r.invoiceId}`)} empty={<EmptyState title="Nothing in this month" message="Bills, credit notes and voids appear here as they happen." />} />
      )}

      {data?.total > 0 && (
        <dl className="ml-auto grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:grid-cols-5">
          {[['Taxable', 'taxable'], ['CGST', 'cgst'], ['SGST', 'sgst'], ['IGST', 'igst'], ['Total', 'total']].map(([label, key]) => (
            <div key={key}>
              <dt className="text-xs text-muted">{label}</dt>
              <dd className="font-semibold text-brown">{formatMoney(data.totals[key])}</dd>
            </div>
          ))}
        </dl>
      )}
      {data && data.pages > 1 && <Pagination page={data.page} pages={data.pages} onChange={setPage} />}
    </div>
  );
}
