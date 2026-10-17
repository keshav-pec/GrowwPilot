import { useState } from 'react';
import toast from 'react-hot-toast';
import { useDirectReceipt, useReturnToSupplier } from '../../../api/inventory/purchasing';
import { useSuppliers } from '../../../api/inventory/suppliers';
import { newRequestKey } from '../../../lib/inventory';
import { toPaise } from '../../../lib/money';
import { Button, Input, Modal, Select } from '../../../components/ui';
import { StoreSelect } from '../actions/fields';
import LinesEditor, { linesValid } from './LinesEditor';

function Footer({ onClose, onSave, saving, disabled, label }) {
  return (
    <>
      <Button variant="secondary" onClick={onClose}>
        Cancel
      </Button>
      <Button onClick={onSave} loading={saving} disabled={disabled}>
        {label}
      </Button>
    </>
  );
}

// A delivery that came without a purchase order. Only what arrived; prices only from owners.
export function DirectReceiptModal({ canSeeCosts, onClose }) {
  const receive = useDirectReceipt();
  const suppliers = useSuppliers().data ?? [];
  const [key] = useState(newRequestKey);
  const [supplierId, setSupplierId] = useState('');
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [storeId, setStoreId] = useState(null);
  const [lines, setLines] = useState([]);

  function save() {
    receive.mutate(
      {
        key,
        supplierId: supplierId || undefined,
        invoiceNumber: invoiceNumber || undefined,
        locationId: storeId || undefined,
        lines: lines.map((l) => ({ skuId: l.sku._id, qty: l.qty, ...(canSeeCosts && l.price && { unitCost: toPaise(l.price) }) })),
      },
      {
        onSuccess: () => {
          toast.success('Delivery added to the store');
          onClose();
        },
      }
    );
  }

  return (
    <Modal open onClose={onClose} size="wide" title="Receive without an order" footer={<Footer onClose={onClose} onSave={save} saving={receive.isPending} disabled={!linesValid(lines)} label="Add to store" />}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Supplier (optional)" placeholder="—" options={suppliers.map((s) => ({ value: s._id, label: s.name }))} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} />
          <Input id="direct-invoice" label="Invoice number (optional)" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          <StoreSelect label="Into" value={storeId} onChange={setStoreId} />
        </div>
        <LinesEditor lines={lines} onChange={setLines} showPrices={canSeeCosts} priceLabel="Paid" />
        {receive.isError && <p className="text-sm text-danger">{receive.error.message}</p>}
      </div>
    </Modal>
  );
}

// Stock sent back to a supplier (its own movement out of the store)
export function ReturnToSupplierModal({ onClose }) {
  const sendBack = useReturnToSupplier();
  const suppliers = useSuppliers().data ?? [];
  const [key] = useState(newRequestKey);
  const [supplierId, setSupplierId] = useState('');
  const [reason, setReason] = useState('');
  const [storeId, setStoreId] = useState(null);
  const [lines, setLines] = useState([]);

  function save() {
    sendBack.mutate(
      { key, supplierId, reason, locationId: storeId || undefined, lines: lines.map((l) => ({ skuId: l.sku._id, qty: l.qty })) },
      {
        onSuccess: () => {
          toast.success('Returned to the supplier');
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      size="wide"
      title="Return to supplier"
      footer={<Footer onClose={onClose} onSave={save} saving={sendBack.isPending} disabled={!supplierId || reason.trim().length < 3 || !linesValid(lines)} label="Return" />}
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Select label="Supplier" placeholder="Choose…" options={suppliers.map((s) => ({ value: s._id, label: s.name }))} value={supplierId} onChange={(e) => setSupplierId(e.target.value)} />
          <Input id="return-reason" label="Why" placeholder="e.g. Leaking caps" value={reason} onChange={(e) => setReason(e.target.value)} />
          <StoreSelect label="From" value={storeId} onChange={setStoreId} />
        </div>
        <LinesEditor lines={lines} onChange={setLines} showPrices={false} />
        {sendBack.isError && <p className="text-sm text-danger">{sendBack.error.message}</p>}
      </div>
    </Modal>
  );
}
