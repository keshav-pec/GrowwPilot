import { useState } from 'react';
import { ClipboardList, PackagePlus, Plus, Undo2 } from 'lucide-react';
import { DateTime } from 'luxon';
import { useAuth } from '../../../auth/AuthContext';
import { useOrders } from '../../../api/inventory/purchasing';
import { PO_STATUS } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { Badge, Button, EmptyState, Select, Table, Tabs } from '../../../components/ui';
import OrderFormModal from './OrderFormModal';
import SuggestionsList from './SuggestionsList';
import SuppliersList from './SuppliersList';
import DeliveriesList from './DeliveriesList';
import { DirectReceiptModal, ReturnToSupplierModal } from './StockInOutModals';

const STATUS_FILTER = [
  { value: 'open', label: 'Open orders' },
  { value: '', label: 'All orders' },
  ...Object.entries(PO_STATUS).map(([value, [label]]) => ({ value, label })),
];

// Purchasing: orders, what to order, deliveries and suppliers
export default function PurchasingTab({ can, onOpenOrder }) {
  const { activeBranch } = useAuth();
  const [section, setSection] = useState('orders');
  const [status, setStatus] = useState('open');
  const [open, setOpen] = useState(null); // 'order' | 'receive' | 'return'
  const ordersQuery = useOrders(status || undefined);
  const canSeeCosts = can['inventory.viewCosts'];
  const canOrder = can['inventory.createPurchaseOrder'];

  const sections = [
    { value: 'orders', label: 'Orders' },
    ...(canOrder ? [{ value: 'suggestions', label: 'Need to order' }] : []),
    { value: 'deliveries', label: 'Deliveries' },
    { value: 'suppliers', label: 'Suppliers' },
  ];

  const columns = [
    { key: 'number', header: 'Order', render: (o) => <span className="font-medium">{o.number}</span> },
    { key: 'supplierName', header: 'Supplier' },
    { key: 'status', header: 'Status', render: (o) => <Badge tone={PO_STATUS[o.status][1]}>{PO_STATUS[o.status][0]}</Badge> },
    { key: 'lines', header: 'Products', render: (o) => o.lines.length },
    ...(canSeeCosts ? [{ key: 'total', header: 'Total', render: (o) => (o.total != null ? formatAmount(o.total) : '—') }] : []),
    { key: 'createdAt', header: 'Created', render: (o) => DateTime.fromISO(o.createdAt, { zone: activeBranch?.timezone }).toFormat('d LLL') },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap justify-end gap-2">
        {can['inventory.returnToSupplier'] && (
          <Button variant="ghost" onClick={() => setOpen('return')}>
            <Undo2 size={16} /> Return to supplier
          </Button>
        )}
        {can['inventory.directReceipt'] && (
          <Button variant="secondary" onClick={() => setOpen('receive')}>
            <PackagePlus size={16} /> Receive without an order
          </Button>
        )}
        {canOrder && (
          <Button onClick={() => setOpen('order')}>
            <Plus size={16} /> New order
          </Button>
        )}
      </div>
      <Tabs tabs={sections} value={section} onChange={setSection} />

      {section === 'orders' && (
        <>
          <div className="mb-3 max-w-xs">
            <Select aria-label="Which orders" options={STATUS_FILTER} value={status} onChange={(e) => setStatus(e.target.value)} />
          </div>
          <Table
            columns={columns}
            rows={ordersQuery.data ?? []}
            loading={ordersQuery.isPending}
            onRowClick={(o) => onOpenOrder(o._id)}
            empty={<EmptyState icon={ClipboardList} title="No purchase orders" message={canOrder ? 'Create one, or start from “Need to order”.' : 'Orders show here.'} />}
          />
        </>
      )}
      {section === 'suggestions' && <SuggestionsList onCreated={() => setSection('orders')} />}
      {section === 'deliveries' && <DeliveriesList />}
      {section === 'suppliers' && <SuppliersList canManage={can['inventory.manageSuppliers']} />}

      {open === 'order' && <OrderFormModal canSeeCosts={canSeeCosts} onClose={() => setOpen(null)} onSaved={(o) => onOpenOrder(o._id)} />}
      {open === 'receive' && <DirectReceiptModal canSeeCosts={canSeeCosts} onClose={() => setOpen(null)} />}
      {open === 'return' && <ReturnToSupplierModal onClose={() => setOpen(null)} />}
    </>
  );
}
