import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Plus } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useAdvanceQuote, useAdvances, useGiveBackAdvance, useTakeAdvance } from '../../api/advances';
import { useCustomerMoney } from '../../api/billingReports';
import { useServices } from '../../api/catalog';
import { useDebounce } from '../../lib/useDebounce';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { formatDate } from '../../lib/time';
import { PAYMENT_METHODS, percentLabel } from '../../lib/billing';
import { newRequestKey } from '../../lib/requestKey';
import { Button, Card, Input, Modal, ModalFooter, Select, Spinner, SummaryRow, Textarea } from '../../components/ui';
import CheckboxList from '../../components/CheckboxList';

// Money the customer paid ahead: what's left, each advance and the bills it paid, and "Take advance".
// Advances can be used at checkout at any branch of the salon.
export default function AdvancesCard({ customer }) {
  const { activeBranch } = useAuth();
  const advances = useAdvances(customer._id);
  const [taking, setTaking] = useState(false);
  const [givingBack, setGivingBack] = useState(null);
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
                  {a.taxed && (
                    <p className="text-xs">
                      <Link to={`/app/advances/${a._id}`} className="underline">Receipt voucher {a.receiptNumber}</Link>
                      <span className="text-muted"> · for {a.forServices.map((f) => f.name).join(', ')} · {formatMoney(a.gst.cgst + a.gst.sgst + a.gst.igst)} GST paid</span>
                    </p>
                  )}
                  {!a.taxed && (
                    <p className="text-xs">
                      <Link to={`/app/advances/${a._id}`} className="underline">Receipt</Link>
                    </p>
                  )}
                  {a.note && <p className="text-xs text-muted">{a.note}</p>}
                  {a.reversed && <p className="text-xs text-danger">The payment was reversed</p>}
                  {a.uses.map((u) => (
                    <p key={`${u.invoiceId}-${u.at}`} className="text-xs text-muted">
                      {formatMoney(u.amount)} used on {u.invoiceNumber}
                    </p>
                  ))}
                  {a.refunds?.map((r) => (
                    <p key={r.paymentId} className="text-xs text-muted">
                      {formatMoney(r.amount)} given back{r.number && ` · ${r.number}`}
                    </p>
                  ))}
                  {advances.data.canGiveBack && a.remaining > 0 && (
                    <button type="button" className="mt-1 text-xs text-brown underline" onClick={() => setGivingBack(a)}>
                      Give back unused money
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {taking && <TakeAdvanceModal customer={customer} namedAllowed={advances.data?.namedAllowed} onClose={() => setTaking(false)} />}
      {givingBack && <GiveBackModal customer={customer} advance={givingBack} onClose={() => setGivingBack(null)} />}
    </Card>
  );
}

const KINDS = [
  { value: 'plain', label: 'Plain advance (no tax now)' },
  { value: 'named', label: 'For named services (tax now, with a receipt voucher)' },
];

function TakeAdvanceModal({ customer, namedAllowed, onClose }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [kind, setKind] = useState('plain');
  const [serviceIds, setServiceIds] = useState([]);
  const [billId, setBillId] = useState('');
  const [key] = useState(newRequestKey);
  const take = useTakeAdvance();
  const valid = isValidRupees(amount) && toPaise(amount) >= 100;
  const isNamed = kind === 'named';
  const services = (useServices().data ?? []).filter((s) => s.status === 'active');
  // Bills that already have GST on them, and money still due: paying those isn't an advance
  const dueBills = (useCustomerMoney(customer._id).data?.bills ?? []).filter((b) => b.status === 'ISSUED' && b.balanceDue > 0);
  const chosenBill = dueBills.find((b) => b._id === billId);

  const typed = useDebounce(amount, 300);
  const typedOk = isValidRupees(typed) && toPaise(typed) >= 100;
  const quote = useAdvanceQuote({ amount: typedOk ? toPaise(typed) : 0, forServiceIds: serviceIds }, isNamed && typedOk && serviceIds.length > 0);
  const namedReady = !isNamed || (serviceIds.length > 0 && quote.isSuccess && !quote.isFetching && !chosenBill);

  function save() {
    take.mutate(
      { key, customerId: customer._id, method, amount: toPaise(amount), reference: reference.trim() || undefined, note: note.trim() || undefined, ...(isNamed ? { forServiceIds: serviceIds } : {}) },
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
        <ModalFooter onClose={onClose} onClick={save} disabled={!valid || !namedReady} loading={take.isPending}>
            Take advance
          </ModalFooter>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {namedAllowed && (
          <div className="sm:col-span-2">
            <Select label="What is it for?" options={KINDS} value={kind} onChange={(e) => setKind(e.target.value)} />
          </div>
        )}
        <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amount && !valid ? 'Enter an amount of at least ₹1' : null} />
        <Select label="Paid by" options={PAYMENT_METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        <Input label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <Input label="Note (optional)" placeholder={isNamed ? 'e.g. 5 haircuts, 5 trims' : 'e.g. Bridal package deposit'} value={note} onChange={(e) => setNote(e.target.value)} />
        {isNamed && (
          <>
            <div className="sm:col-span-2">
              <CheckboxList label="Services" items={services} value={serviceIds} onChange={setServiceIds} />
            </div>
            {dueBills.length > 0 && (
              <div className="sm:col-span-2">
                <Select
                  label="Is this money for a bill already issued?"
                  options={[{ value: '', label: 'No' }, ...dueBills.map((b) => ({ value: b._id, label: `${b.invoiceNumber} · ${formatMoney(b.balanceDue)} due` }))]}
                  value={billId}
                  onChange={(e) => setBillId(e.target.value)}
                />
                {chosenBill && (
                  <p className="mt-1 text-sm text-orange">
                    That bill already has GST on this money. <Link to={`/app/invoices/${chosenBill._id}`} className="font-medium underline">Record the payment on the bill</Link> instead.
                  </p>
                )}
              </div>
            )}
            {quote.isError && <p className="text-sm text-danger sm:col-span-2">{quote.error.message}</p>}
            {quote.isSuccess && !chosenBill && (
              <dl className="flex flex-col gap-1 rounded-lg bg-surface p-3 text-sm sm:col-span-2">
                <SummaryRow label={`Taxable value (${quote.data.taxRuleName}, SAC ${quote.data.code}, ${percentLabel(quote.data.rateBps)})`} value={formatMoney(quote.data.taxable)} />
                <SummaryRow label="CGST" value={formatMoney(quote.data.cgst)} muted />
                <SummaryRow label="SGST" value={formatMoney(quote.data.sgst)} muted />
              </dl>
            )}
          </>
        )}
      </div>
      <p className="mt-3 text-xs text-muted">
        {isNamed ? 'The customer gets a numbered receipt voucher. The tax is used up on later bills, so this money isn’t taxed twice. It can only be used at branches on the same GSTIN.' : 'It can be used at checkout at any branch.'}
      </p>
    </Modal>
  );
}

// Unused money back to the customer. A taxed advance takes its tax back too, with a numbered refund voucher.
function GiveBackModal({ customer, advance, onClose }) {
  const [amount, setAmount] = useState(String(advance.remaining / 100));
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [key] = useState(newRequestKey);
  const giveBack = useGiveBackAdvance();
  const paise = isValidRupees(amount) ? toPaise(amount) : 0;
  const amountError = !paise ? 'Enter an amount' : paise > advance.remaining ? `Only ${formatMoney(advance.remaining)} is left` : null;

  function save() {
    giveBack.mutate(
      { key, _id: advance._id, customerId: customer._id, amount: paise, method, reference: reference.trim() || undefined, reason: reason.trim() },
      {
        onSuccess: () => {
          toast.success(`${formatMoney(paise)} given back`);
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title={`Give back ${customer.name}’s advance`}
      footer={
        <ModalFooter onClose={onClose} onClick={save} disabled={Boolean(amountError) || reason.trim().length < 3} loading={giveBack.isPending}>
            Give back {paise && !amountError ? formatMoney(paise) : ''}
          </ModalFooter>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={amountError} hint={`${formatMoney(advance.remaining)} is left`} />
        <Select label="Given back by" options={PAYMENT_METHODS} value={method} onChange={(e) => setMethod(e.target.value)} />
        <Input label="Reference (optional)" value={reference} onChange={(e) => setReference(e.target.value)} />
        <div className="sm:col-span-2">
          <Textarea label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        {giveBack.isError && <p className="text-sm text-danger sm:col-span-2">{giveBack.error.message}</p>}
      </div>
      {advance.taxed && <p className="mt-3 text-xs text-muted">The GST on this money is taken back too, with a numbered refund voucher.</p>}
    </Modal>
  );
}
