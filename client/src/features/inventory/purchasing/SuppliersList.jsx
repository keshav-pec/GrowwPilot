import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus, Truck } from 'lucide-react';
import { useSaveSupplier, useSuppliers } from '../../../api/inventory/suppliers';
import { newRequestKey } from '../../../lib/inventory';
import { Badge, Button, EmptyState, Input, Modal, Table, Textarea } from '../../../components/ui';

// Suppliers (INV-10): who the salon buys from. Prices are on the orders, so nothing here is a cost.
export default function SuppliersList({ canManage }) {
  const suppliersQuery = useSuppliers({ includeInactive: true });
  const [editing, setEditing] = useState(null); // 'new' | supplier

  const columns = [
    { key: 'name', header: 'Supplier', render: (s) => <span className="font-medium">{s.name}</span> },
    { key: 'contact', header: 'Contact', render: (s) => [s.contactName, s.phone].filter(Boolean).join(' · ') || '—' },
    { key: 'paymentTerms', header: 'Payment terms', render: (s) => s.paymentTerms || '—' },
    { key: 'leadTimeDays', header: 'Delivery takes', render: (s) => (s.leadTimeDays != null ? `${s.leadTimeDays} day${s.leadTimeDays === 1 ? '' : 's'}` : '—') },
    { key: 'active', header: '', render: (s) => !s.active && <Badge>Inactive</Badge> },
  ];

  return (
    <>
      {canManage && (
        <div className="mb-3 flex justify-end">
          <Button onClick={() => setEditing('new')}>
            <Plus size={16} /> Add supplier
          </Button>
        </div>
      )}
      <Table
        columns={columns}
        rows={suppliersQuery.data ?? []}
        loading={suppliersQuery.isPending}
        onRowClick={canManage ? (s) => setEditing(s) : undefined}
        empty={<EmptyState icon={Truck} title="No suppliers yet" message="Add the companies you buy stock from." />}
      />
      {editing && <SupplierFormModal supplier={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </>
  );
}

function SupplierFormModal({ supplier, onClose }) {
  const save = useSaveSupplier();
  const [key] = useState(newRequestKey);
  const [values, setValues] = useState({
    name: supplier?.name ?? '',
    contactName: supplier?.contactName ?? '',
    phone: supplier?.phone ?? '',
    email: supplier?.email ?? '',
    paymentTerms: supplier?.paymentTerms ?? '',
    leadTimeDays: supplier?.leadTimeDays != null ? String(supplier.leadTimeDays) : '',
    notes: supplier?.notes ?? '',
  });
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.value }));

  function submit(extra = {}) {
    const body = { ...values, leadTimeDays: values.leadTimeDays === '' ? null : Number(values.leadTimeDays), ...extra };
    save.mutate(supplier ? { key: extra.active === undefined ? key : newRequestKey(), _id: supplier._id, ...body } : { key, ...body }, {
      onSuccess: () => {
        toast.success('Saved');
        onClose();
      },
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={supplier ? `Edit ${supplier.name}` : 'Add supplier'}
      footer={
        <>
          {supplier && (
            <Button variant="ghost" className="mr-auto" onClick={() => submit({ active: !supplier.active })}>
              {supplier.active ? 'Deactivate' : 'Activate'}
            </Button>
          )}
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => submit()} loading={save.isPending} disabled={values.name.trim().length < 2 || (values.leadTimeDays !== '' && !/^\d+$/.test(values.leadTimeDays))}>
            Save
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input id="sup-name" label="Name" value={values.name} onChange={set('name')} />
        <Input id="sup-contact" label="Contact person (optional)" value={values.contactName} onChange={set('contactName')} />
        <Input id="sup-phone" label="Phone (optional)" value={values.phone} onChange={set('phone')} />
        <Input id="sup-email" label="Email (optional)" value={values.email} onChange={set('email')} />
        <Input id="sup-terms" label="Payment terms (optional)" placeholder="e.g. 30 days" value={values.paymentTerms} onChange={set('paymentTerms')} />
        <Input id="sup-lead" label="Delivery takes (days)" inputMode="numeric" value={values.leadTimeDays} onChange={set('leadTimeDays')} />
        <div className="sm:col-span-2">
          <Textarea id="sup-notes" label="Notes (optional)" value={values.notes} onChange={set('notes')} />
        </div>
        {save.isError && <p className="text-sm text-danger sm:col-span-2">{save.error.message}</p>}
      </div>
    </Modal>
  );
}
