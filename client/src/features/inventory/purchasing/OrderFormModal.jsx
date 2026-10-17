import { useState } from 'react';
import toast from 'react-hot-toast';
import { useSaveOrder } from '../../../api/inventory/purchasing';
import { useSuppliers } from '../../../api/inventory/suppliers';
import { newRequestKey } from '../../../lib/inventory';
import { toPaise } from '../../../lib/money';
import { Button, Input, Modal, Select } from '../../../components/ui';
import LinesEditor, { linesValid } from './LinesEditor';

// New purchase order (saved as a draft), or changes to a draft. Only owners see and type prices.
export default function OrderFormModal({ order, canSeeCosts, onClose, onSaved }) {
  const saveOrder = useSaveOrder();
  const suppliers = useSuppliers().data ?? [];
  const [key] = useState(newRequestKey);
  const [supplierId, setSupplierId] = useState(order?.supplierId ?? '');
  const [lines, setLines] = useState(() =>
    (order?.lines ?? []).map((l) => ({ sku: l.sku, qty: l.qty, price: l.unitCost != null ? String(l.unitCost / 100) : '' }))
  );
  const [expectedDate, setExpectedDate] = useState(order?.expectedDate ?? '');
  const [note, setNote] = useState(order?.note ?? '');

  function save() {
    const payload = {
      supplierId,
      lines: lines.map((l) => ({ skuId: l.sku._id, qty: l.qty, ...(canSeeCosts && { unitCost: l.price ? toPaise(l.price) : null }) })),
      expectedDate: expectedDate || null,
      note: note || undefined,
    };
    saveOrder.mutate(order ? { key, _id: order._id, version: order.version, ...payload } : { key, ...payload }, {
      onSuccess: (data) => {
        toast.success(order ? 'Saved' : `${data.order.number} saved as a draft`);
        onSaved?.(data.order);
        onClose();
      },
    });
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title={order ? `Edit ${order.number}` : 'New purchase order'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={saveOrder.isPending} disabled={!supplierId || !linesValid(lines)}>
            Save draft
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Select label="Supplier" placeholder="Choose…" options={suppliers.map((s) => ({ value: s._id, label: s.name }))} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} />
          <Input id="po-expected" type="date" label="Expected on (optional)" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
        </div>
        {suppliers.length === 0 && <p className="text-sm text-muted">Add a supplier first (Purchasing → Suppliers).</p>}
        <LinesEditor lines={lines} onChange={setLines} showPrices={canSeeCosts} />
        <Input id="po-note" label="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
        {saveOrder.isError && <p className="text-sm text-danger">{saveOrder.error.message}</p>}
      </div>
    </Modal>
  );
}
