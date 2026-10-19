import { useState } from 'react';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAdvances, useTakeAdvance } from '../../api/advances';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { PAYMENT_METHODS, newRequestKey } from '../../lib/billing';
import { Button, Card, Input, Modal, Select, Spinner } from '../../components/ui';

// Money the customer paid ahead: what's left, each advance and the bills it paid, and "Take advance".
// Advances can be used at checkout at any branch of the salon.
export default function AdvancesCard({ customer }) {
  const { activeBranch } = useAuth();
  const advances = useAdvances(customer._id);
  const [taking, setTaking] = useState(false);
  const list = advances.data?.advances ?? [];

  return (
    <Card
      title="Advance"
      actions={
        <Button size="sm" variant="secondary" onClick={() => setTaking(true)}>
          <Plus size={14} /> Take advance
        </Button>
      }
    >
      {advances.isPending ? (
        <Spinner />
      ) : (
        <>
          <p className="text-2xl font-semibold text-brown">{formatMoney(advances.data?.balance ?? 0)}</p>
          <p className="text-xs text-muted">left to use on bills</p>
          {list.length > 0 && (
            <ul className="mt-3 divide-y divide-border text-sm">
              {list.map((a) => (
                <li key={a._id} className="py-2">
                  <p className="flex justify-between">
                    <span>
                      {formatMoney(a.amount)} on {formatDate(a.createdAt, activeBranch.timezone)}
                      {a.branchId?.name && <span className="text-muted"> · {a.branchId.name}</span>}
                    </span>
                    <span className={a.reversed ? 'text-muted line-through' : ''}>{formatMoney(a.remaining)} left</span>
                  </p>
                  {a.note && <p className="text-xs text-muted">{a.note}</p>}
                  {a.reversed && <p className="text-xs text-danger">The payment was reversed</p>}
                  {a.uses.map((u) => (
                    <p key={`${u.invoiceId}-${u.at}`} className="text-xs text-muted">
                      {formatMoney(u.amount)} used on {u.invoiceNumber}
                    </p>
                  ))}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {taking && <TakeAdvanceModal customer={customer} onClose={() => setTaking(false)} />}
    </Card>
  );
}

function TakeAdvanceModal({ customer, onClose }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [key] = useState(newRequestKey);
  const take = useTakeAdvance();
  const valid = isValidRupees(amount) && toPaise(amount) >= 100;

  function save() {
    take.mutate(
      { key, customerId: customer._id, method, amount: toPaise(amount), reference: reference.trim() || undefined, note: note.trim() || undefined },
      {
        onSuccess: () => {
          toast.success(`Advance of ${formatMoney(toPaise(amount))} taken`);
          onClose();
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Take an advance from ${customer.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} disabled={!valid} loading={take.isPending}>
            Take advance
          </Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && !valid ? 'Enter an amount of at least ₹1' : null} />
        <Select label="Paid by" options={PAYMENT_METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        <Input label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input label="Note (optional)" placeholder="e.g. Bridal package deposit" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>
      <p className="mt-3 text-xs text-muted">It can be used at checkout at any branch.</p>
    </Modal>
  );
}
