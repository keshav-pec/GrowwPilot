import { useState } from 'react';
import toast from 'react-hot-toast';
import { DateTime } from 'luxon';
import { useOrder, useOrderStep } from '../../../api/inventory/purchasing';
import { PO_STATUS, formatQty, newRequestKey } from '../../../lib/inventory';
import { formatAmount, isValidRupees, toPaise } from '../../../lib/money';
import { Badge, Button, Drawer, Input, Modal, Spinner } from '../../../components/ui';
import { QtyField, StoreSelect } from '../actions/fields';
import OrderFormModal from './OrderFormModal';

const STEP_DONE = { submit: 'Sent', order: 'Marked as ordered', cancel: 'Cancelled', close: 'Closed' };

// One purchase order (INV-11): its lines, what has arrived, and the next step
export default function OrderDrawer({ orderId, canSeeCosts, onClose }) {
  const orderQuery = useOrder(orderId);
  const step = useOrderStep();
  const [open, setOpen] = useState(null); // 'edit' | 'receive' | 'sendBack'

  const { order, receipts = [], can = {} } = orderQuery.data ?? {};

  function run(name, body = {}) {
    step.mutate(
      { key: newRequestKey(), id: order._id, step: name, ...body },
      { onSuccess: () => toast.success(name === 'decide' ? (body.approve ? 'Approved' : 'Sent back') : STEP_DONE[name]), onError: (err) => toast.error(err.message) }
    );
  }

  const footer = order && (
    <div className="flex w-full flex-wrap justify-end gap-2">
      {['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ORDERED'].includes(order.status) && !order.lines.some((l) => l.receivedQty > 0) && (
        <Button variant="ghost" className="mr-auto" onClick={() => run('cancel')}>
          Cancel order
        </Button>
      )}
      {can.edit && (
        <Button variant="secondary" onClick={() => setOpen('edit')}>
          Edit
        </Button>
      )}
      {order.status === 'DRAFT' && <Button onClick={() => run('submit')}>Send</Button>}
      {can.approve && (
        <>
          <Button variant="secondary" onClick={() => setOpen('sendBack')}>
            Send back
          </Button>
          <Button onClick={() => run('decide', { approve: true })}>Approve</Button>
        </>
      )}
      {order.status === 'APPROVED' && (
        <Button variant="secondary" onClick={() => run('order')}>
          Mark as ordered
        </Button>
      )}
      {can.receive && <Button onClick={() => setOpen('receive')}>Receive delivery</Button>}
      {['PARTIALLY_RECEIVED', 'RECEIVED'].includes(order.status) && (
        <Button variant="secondary" onClick={() => run('close')}>
          Close order
        </Button>
      )}
    </div>
  );

  return (
    <Drawer open onClose={onClose} title={order ? order.number : 'Purchase order'} footer={footer}>
      {orderQuery.isPending ? (
        <Spinner size={24} />
      ) : orderQuery.isError ? (
        <p className="text-sm text-danger">{orderQuery.error.message}</p>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
            <Badge tone={PO_STATUS[order.status][1]}>{PO_STATUS[order.status][0]}</Badge>
            <span className="font-medium">{order.supplierName}</span>
            {order.expectedDate && <span className="text-muted">· expected {DateTime.fromISO(order.expectedDate).toFormat('d LLL')}</span>}
          </div>
          {order.decisionNote && <p className="mb-3 rounded-lg bg-surface px-3 py-2 text-sm">{order.decisionNote}</p>}
          {order.status === 'PENDING_APPROVAL' && !can.approve && <p className="mb-3 text-sm text-muted">Waiting for an owner to approve it.</p>}

          <ul className="mb-4 divide-y divide-border rounded-lg border border-border text-sm">
            {order.lines.map((l) => (
              <li key={l._id} className="px-3 py-2">
                <div className="flex justify-between gap-2">
                  <span className="font-medium">{l.skuName}</span>
                  {canSeeCosts && l.unitCost != null && <span className="text-muted">{formatAmount(l.unitCost)} each</span>}
                </div>
                <p className="text-xs text-muted">
                  Ordered {formatQty(l.qty, l.sku)}
                  {l.receivedQty > 0 && ` · received ${formatQty(l.receivedQty, l.sku)}`}
                </p>
              </li>
            ))}
          </ul>
          {canSeeCosts && <p className="mb-4 text-sm">Total: {order.total != null ? <strong>{formatAmount(order.total)}</strong> : <span className="text-muted">some prices missing</span>}</p>}
          <p className="mb-5 text-xs text-muted">
            Created by {order.createdBy?.name} {DateTime.fromISO(order.createdAt).toRelative()}
            {order.approvedBy && ` · approved by ${order.approvedBy.name}`}
          </p>

          <h3 className="mb-2 text-sm font-semibold text-brown">Deliveries</h3>
          {receipts.length === 0 ? (
            <p className="text-sm text-muted">Nothing has arrived yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {receipts.map((r) => (
                <li key={r._id} className="px-3 py-2">
                  <p>{r.lines.map((l) => `${l.qty} × ${l.skuName}`).join(', ')}</p>
                  <p className="text-xs text-muted">
                    {DateTime.fromISO(r.at).toFormat('d LLL, h:mm a')} · {r.by?.name}
                    {r.invoiceNumber && ` · invoice ${r.invoiceNumber}`}
                    {r.overReceipt?.reason && ` · more than ordered: ${r.overReceipt.reason}`}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}

      {open === 'edit' && <OrderFormModal order={order} canSeeCosts={canSeeCosts} onClose={() => setOpen(null)} />}
      {open === 'receive' && <ReceiveModal order={order} canSeeCosts={canSeeCosts} acceptMore={can.acceptMore} onClose={() => setOpen(null)} />}
      {open === 'sendBack' && (
        <SendBackModal
          onSend={(note) => {
            run('decide', { approve: false, note });
            setOpen(null);
          }}
          onClose={() => setOpen(null)}
        />
      )}
    </Drawer>
  );
}

// Receive a delivery (INV-12): only what arrived. More than was ordered needs the business owner and a reason.
function ReceiveModal({ order, canSeeCosts, acceptMore, onClose }) {
  const step = useOrderStep();
  const [key] = useState(newRequestKey);
  const [arrived, setArrived] = useState(() => Object.fromEntries(order.lines.map((l) => [l._id, Math.max(l.qty - l.receivedQty, 0)])));
  const [prices, setPrices] = useState({});
  const [batches, setBatches] = useState({});
  const [invoiceNumber, setInvoiceNumber] = useState('');
  const [storeId, setStoreId] = useState(null);
  const [overReason, setOverReason] = useState('');

  const over = order.lines.some((l) => l.receivedQty + (arrived[l._id] ?? 0) > l.qty);
  const anything = Object.values(arrived).some((q) => q > 0);
  const pricesOk = Object.values(prices).every((p) => !p || isValidRupees(p));

  function save() {
    step.mutate(
      {
        key,
        id: order._id,
        step: 'receive',
        invoiceNumber: invoiceNumber || undefined,
        locationId: storeId || undefined,
        overReceiptReason: over ? overReason : undefined,
        lines: order.lines.map((l) => ({
          lineId: l._id,
          qty: arrived[l._id] ?? 0,
          ...(canSeeCosts && prices[l._id] && { unitCost: toPaise(prices[l._id]) }),
          ...(batches[l._id]?.batch && { batch: batches[l._id].batch }),
          ...(batches[l._id]?.expiryDate && { expiryDate: batches[l._id].expiryDate }),
        })),
      },
      {
        onSuccess: () => {
          toast.success('Delivery received into the store');
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
      title={`Receive ${order.number}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={step.isPending} disabled={!anything || !pricesOk || (over && (!acceptMore || overReason.trim().length < 3))}>
            Receive
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <Input id="rcv-invoice" label="Supplier invoice number (optional)" value={invoiceNumber} onChange={(e) => setInvoiceNumber(e.target.value)} />
          <StoreSelect label="Into" value={storeId} onChange={setStoreId} />
        </div>
        {order.lines.map((l) => (
          <div key={l._id} className="rounded-lg border border-border p-3">
            <p className="font-medium">{l.skuName}</p>
            <p className="mb-2 text-xs text-muted">
              Ordered {formatQty(l.qty, l.sku)}, received so far {formatQty(l.receivedQty, l.sku)}
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <QtyField sku={l.sku} label="Arrived now" value={arrived[l._id] ?? 0} onChange={(q) => setArrived((a) => ({ ...a, [l._id]: q }))} />
              {canSeeCosts && (
                <Input
                  id={`rcv-price-${l._id}`}
                  label={`Price paid per ${l.sku.stockUnit} (₹)`}
                  inputMode="decimal"
                  placeholder={l.unitCost != null ? `${l.unitCost / 100} (ordered price)` : 'Optional'}
                  value={prices[l._id] ?? ''}
                  onChange={(e) => setPrices((p) => ({ ...p, [l._id]: e.target.value }))}
                />
              )}
              <Input id={`rcv-batch-${l._id}`} label="Batch (optional)" value={batches[l._id]?.batch ?? ''} onChange={(e) => setBatches((b) => ({ ...b, [l._id]: { ...b[l._id], batch: e.target.value } }))} />
              <Input id={`rcv-expiry-${l._id}`} type="date" label="Expiry (optional)" value={batches[l._id]?.expiryDate ?? ''} onChange={(e) => setBatches((b) => ({ ...b, [l._id]: { ...b[l._id], expiryDate: e.target.value } }))} />
            </div>
          </div>
        ))}
        {over &&
          (acceptMore ? (
            <Input id="rcv-over" label="More than was ordered: why are you accepting it?" value={overReason} onChange={(e) => setOverReason(e.target.value)} />
          ) : (
            <p className="text-sm text-danger">That’s more than was ordered. Only the business owner can accept extra; receive what was ordered for now.</p>
          ))}
        {step.isError && <p className="text-sm text-danger">{step.error.message}</p>}
      </div>
    </Modal>
  );
}

function SendBackModal({ onSend, onClose }) {
  const [note, setNote] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Send the order back"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={note.trim().length < 3} onClick={() => onSend(note)}>
            Send back
          </Button>
        </>
      }
    >
      <Input id="sendback-note" label="What should change?" autoFocus placeholder="e.g. Order 10, not 20" value={note} onChange={(e) => setNote(e.target.value)} />
    </Modal>
  );
}
