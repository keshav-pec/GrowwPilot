import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, Clock, Pencil, ShieldAlert } from 'lucide-react';
import { useApproveDiscount, useIssueInvoice, useQuote, useRejectDiscount, useRequestApproval, useSaveDraft } from '../../api/invoices';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { newRequestKey, percentLabel } from '../../lib/billing';
import { useDebounce } from '../../lib/useDebounce';
import { Button, Card, Input, Modal, Spinner, Textarea } from '../../components/ui';
import DiscountInput, { discountText, parseDiscount } from '../billing/DiscountInput';
import PaymentRows, { emptyPayment, paidTotal, paymentsPayload, rowsInvalid } from '../billing/PaymentRows';

// What's in the boxes, starting from the saved draft
function startingEdits(draft) {
  return {
    lines: Object.fromEntries(draft.lines.map((l) => [l._id, { ...discountText(l.discountType, l.discountValue), unitPrice: l.unitPrice, reason: l.priceChangeReason ?? '' }])),
    bill: discountText(draft.billDiscountType, draft.billDiscountValue),
  };
}

// The draft bill on the checkout screen: discounts, live prices from the server, approval, payments, Issue & Pay.
// onReplace(invoice) is called with the saved draft after every change; onStale reloads it.
export default function DraftEditor({ draft, onReplace, onStale }) {
  const navigate = useNavigate();
  const [edits, setEdits] = useState(() => startingEdits(draft));
  const [rows, setRows] = useState([emptyPayment()]);
  const [note, setNote] = useState('');
  const [priceLine, setPriceLine] = useState(null); // line being re-priced (owners)
  const [rejecting, setRejecting] = useState(false);
  const [key, setKey] = useState(newRequestKey); // one key per money action; renewed after each

  const saveDraft = useSaveDraft();
  const issue = useIssueInvoice();
  const requestApproval = useRequestApproval();
  const approve = useApproveDiscount();
  const reject = useRejectDiscount();

  // ----- What was typed -> what the server needs -----
  const parsedLines = draft.lines.map((l) => parseDiscount(edits.lines[l._id]));
  const parsedBill = parseDiscount(edits.bill);
  const inputError = parsedLines.some((p) => p.error) || Boolean(parsedBill.error);
  const payload = {
    billDiscount: parsedBill.value ?? null,
    lines: draft.lines.map((l, i) => {
      const e = edits.lines[l._id];
      return { lineId: l._id, discount: parsedLines[i].value ?? null, ...(e.unitPrice !== l.unitPrice ? { unitPrice: e.unitPrice, priceChangeReason: e.reason } : {}) };
    }),
  };

  // Ask the server for prices once typing stops (it does all the maths; this screen only shows it)
  const payloadKey = JSON.stringify(payload);
  const settledKey = useDebounce(payloadKey, 300);
  const settledPayload = useMemo(() => JSON.parse(settledKey), [settledKey]);
  const quote = useQuote(draft._id, settledPayload, !inputError);
  const shown = quote.data ?? draft;
  const upToDate = !inputError && settledKey === payloadKey && !quote.isFetching && !quote.isError;

  const total = shown.grandTotal;
  const paying = paidTotal(rows);
  const due = total - paying;
  const limits = shown.limits ?? {};
  const approval = shown.approval ?? { status: 'NONE' };
  const permissions = shown.permissions ?? {};
  const canIssue = upToDate && !rowsInvalid(rows) && due >= 0 && !limits.needsApproval;
  const busy = saveDraft.isPending || issue.isPending || requestApproval.isPending || approve.isPending || reject.isPending;

  function setLine(lineId, change) {
    setEdits((current) => ({ ...current, lines: { ...current.lines, [lineId]: { ...current.lines[lineId], ...change } } }));
  }

  // Shared result handling: keep the saved draft, a fresh key, and reload if someone else changed it
  const handlers = (success) => ({
    onSuccess: (invoice) => {
      setKey(newRequestKey());
      onReplace(invoice);
      success?.(invoice);
    },
    onError: (err) => {
      toast.error(err.message);
      if (err.code === 'STALE_VERSION') onStale();
    },
  });

  function doIssue() {
    issue.mutate(
      { _id: draft._id, key, version: draft.version, ...payload, payments: paymentsPayload(rows) },
      handlers((invoice) => {
        toast.success(invoice.balanceDue > 0 ? `Bill ${invoice.invoiceNumber} issued · ${formatMoney(invoice.balanceDue)} due` : `Paid · ${invoice.invoiceNumber}`);
        navigate(`/app/invoices/${invoice._id}`);
      })
    );
  }

  const discountShare = (field) => shown.lines.reduce((sum, l) => sum + (l[field] ?? 0), 0);
  const lineDiscounts = discountShare('lineDiscount');
  const billDiscount = discountShare('billDiscountShare');
  const payLabel = paying === 0 ? `Issue bill · ${formatMoney(total)} due` : due > 0 ? `Issue & pay ${formatMoney(paying)} · ${formatMoney(due)} due` : `Issue & pay ${formatMoney(total)}`;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title="Bill" actions={quote.isFetching && <Spinner size={16} />}>
        <ul className="divide-y divide-border text-sm">
          {draft.lines.map((line, i) => {
            const now = shown.lines.find((l) => l._id === line._id) ?? line;
            const e = edits.lines[line._id];
            const changedPrice = e.unitPrice !== line.listUnitPrice;
            return (
              <li key={line._id} className="flex flex-col gap-2 py-3">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="font-medium">{line.name}</p>
                    <p className="text-xs text-muted">
                      {line.staffName}
                      {now.sacCode && ` · SAC ${now.sacCode}`}
                      {shown.gstRegistered && ` · GST ${percentLabel(now.taxRateBps)}`}
                    </p>
                  </div>
                  <div className="text-right">
                    {changedPrice && <p className="text-xs text-muted line-through">{formatMoney(line.listUnitPrice)}</p>}
                    <p className="flex items-center justify-end gap-1">
                      {formatMoney(e.unitPrice)}
                      {permissions.changePrice && (
                        <button type="button" onClick={() => setPriceLine(line)} className="rounded p-0.5 text-muted hover:text-ink" aria-label={`Change the price of ${line.name}`}>
                          <Pencil size={13} />
                        </button>
                      )}
                    </p>
                    {changedPrice && e.reason && <p className="text-xs text-muted">{e.reason}</p>}
                  </div>
                </div>
                {now.comboDiscount > 0 && (
                  <div className="flex justify-between text-xs text-muted">
                    <span>Combo price</span>
                    <span>−{formatMoney(now.comboDiscount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <DiscountInput value={e} onChange={(v) => setLine(line._id, { type: v.type, text: v.text })} error={parsedLines[i].error} label={`Discount on ${line.name}`} />
                  {now.lineDiscount > 0 && <span className="text-muted">−{formatMoney(now.lineDiscount)}</span>}
                </div>
              </li>
            );
          })}
        </ul>

        <dl className="mt-3 flex flex-col gap-2 border-t border-border pt-3 text-sm">
          <Row label="Subtotal" value={formatMoney(shown.subtotal)} />
          {shown.comboDiscountTotal > 0 && <Row label="Combo price" value={`−${formatMoney(shown.comboDiscountTotal)}`} muted />}
          {lineDiscounts > 0 && <Row label="Line discounts" value={`−${formatMoney(lineDiscounts)}`} muted />}
          <div className="flex items-center justify-between gap-2">
            <dt>Bill discount</dt>
            <dd className="flex items-center gap-3">
              {billDiscount > 0 && <span className="text-muted">−{formatMoney(billDiscount)}</span>}
              <DiscountInput value={edits.bill} onChange={(bill) => setEdits((c) => ({ ...c, bill }))} error={parsedBill.error} label="Bill discount" />
            </dd>
          </div>
          {shown.gstRegistered && (
            <>
              <Row label="Taxable value" value={formatMoney(shown.taxableTotal)} muted />
              {shown.taxSummary.map((t) => (
                <div key={t.rateBps}>
                  <Row label={`CGST ${percentLabel(t.rateBps / 2)}`} value={formatMoney(t.cgst)} muted />
                  <Row label={`SGST ${percentLabel(t.rateBps / 2)}`} value={formatMoney(t.sgst)} muted />
                </div>
              ))}
            </>
          )}
          <div className="flex justify-between border-t border-border pt-2 text-lg font-bold text-brown">
            <dt>Total</dt>
            <dd>{formatMoney(total)}</dd>
          </div>
          {shown.gstRegistered && <p className="text-xs text-muted">{shown.pricesIncludeTax ? 'Prices include GST.' : 'GST is added on top of the prices.'}</p>}
          {quote.isError && <p className="text-sm text-danger">{quote.error.message}</p>}
        </dl>
      </Card>

      <Card title="Payment">
        {total === 0 ? <p className="text-sm text-muted">Nothing to pay.</p> : <PaymentRows rows={rows} onChange={setRows} total={total} />}

        <div
          className={`mt-4 flex justify-between rounded-lg px-3 py-2 text-sm font-medium ${
            due < 0 ? 'bg-danger/10 text-danger' : due === 0 ? 'bg-brown/10 text-brown' : 'bg-orange/10 text-orange'
          }`}
        >
          <span>{due < 0 ? 'Too much by' : due === 0 ? 'Fully paid' : 'Will be due'}</span>
          <span>{formatMoney(Math.abs(due))}</span>
        </div>
        {due > 0 && paying > 0 && <p className="mt-1 text-xs text-muted">The rest can be taken later with “Record payment” on the bill.</p>}

        <ApprovalBox
          limits={limits}
          approval={approval}
          permissions={permissions}
          note={note}
          onNote={setNote}
          busy={busy}
          onRequest={() => requestApproval.mutate({ _id: draft._id, key, version: draft.version, ...payload, note: note.trim() || undefined }, handlers(() => toast.success('Sent to the owner for approval')))}
          onApprove={() => approve.mutate({ _id: draft._id, key, version: draft.version }, handlers(() => toast.success('Discount approved')))}
          onReject={() => setRejecting(true)}
          canRequest={upToDate}
        />

        <Button className="mt-4 w-full" onClick={doIssue} disabled={!canIssue || busy} loading={issue.isPending}>
          {payLabel}
        </Button>
        <Button
          variant="secondary"
          className="mt-2 w-full"
          disabled={inputError || busy}
          loading={saveDraft.isPending}
          onClick={() => saveDraft.mutate({ _id: draft._id, version: draft.version, ...payload }, handlers(() => toast.success('Draft saved')))}
        >
          Save draft
        </Button>
      </Card>

      {priceLine && (
        <PriceModal
          line={priceLine}
          current={edits.lines[priceLine._id]}
          onClose={() => setPriceLine(null)}
          onSave={(unitPrice, reason) => {
            setLine(priceLine._id, { unitPrice, reason });
            setPriceLine(null);
          }}
        />
      )}
      {rejecting && (
        <RejectModal
          loading={reject.isPending}
          onClose={() => setRejecting(false)}
          onReject={(reason) =>
            reject.mutate(
              { _id: draft._id, key, version: draft.version, note: reason },
              handlers(() => {
                setRejecting(false);
                toast.success('Discount turned down');
              })
            )
          }
        />
      )}
    </div>
  );
}

function Row({ label, value, muted = false }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

// The front desk discount limit, and asking an owner to approve a bigger discount
function ApprovalBox({ limits, approval, permissions, note, onNote, busy, onRequest, onApprove, onReject, canRequest }) {
  if (approval.status === 'PENDING') {
    return (
      <div className="mt-4 rounded-lg border border-yellow bg-yellow-soft p-3 text-sm">
        <p className="flex items-center gap-2 font-medium">
          <Clock size={16} /> Waiting for an owner to approve a {formatMoney(approval.requestedDiscount)} discount
        </p>
        <p className="mt-1 text-muted">
          Asked by {approval.requestedByName}
          {approval.note && ` · “${approval.note}”`}
        </p>
        {permissions.approve && (
          <div className="mt-3 flex gap-2">
            <Button size="sm" onClick={onApprove} disabled={busy}>
              Approve discount
            </Button>
            <Button size="sm" variant="secondary" onClick={onReject} disabled={busy}>
              Turn down
            </Button>
          </div>
        )}
      </div>
    );
  }
  if (limits.needsApproval) {
    return (
      <div className="mt-4 rounded-lg border border-orange/40 bg-orange/10 p-3 text-sm">
        <p className="flex items-center gap-2 font-medium text-orange">
          <ShieldAlert size={16} /> This discount is above your limit of {percentLabel(limits.limitBps)} ({formatMoney(limits.limitAmount)})
        </p>
        {approval.status === 'REJECTED' && (
          <p className="mt-1">
            {approval.decidedByName} turned it down{approval.decisionNote && `: “${approval.decisionNote}”`}
          </p>
        )}
        <p className="mt-1 text-muted">Lower the discount, or ask an owner to approve it.</p>
        <div className="mt-2">
          <Input placeholder="Why? (optional, e.g. regular customer)" value={note} onChange={(e) => onNote(e.target.value)} aria-label="Reason for the discount" />
        </div>
        <Button size="sm" variant="secondary" className="mt-2" onClick={onRequest} disabled={busy || !canRequest}>
          Ask owner to approve
        </Button>
      </div>
    );
  }
  if (approval.status === 'APPROVED') {
    return (
      <p className="mt-4 flex items-center gap-2 text-sm text-brown">
        <CheckCircle2 size={16} /> Discount approved by {approval.decidedByName}
      </p>
    );
  }
  return null;
}

// Owners only: a different price for one line, with a reason (kept on the bill and in the activity log)
function PriceModal({ line, current, onClose, onSave }) {
  const [price, setPrice] = useState(String(current.unitPrice / 100));
  const [reason, setReason] = useState(current.unitPrice === line.listUnitPrice ? '' : current.reason);
  const valid = isValidRupees(price);
  const backToList = valid && toPaise(price) === line.listUnitPrice;
  return (
    <Modal
      open
      onClose={onClose}
      title={`Price of ${line.name}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!valid || (!backToList && reason.trim().length < 2)} onClick={() => onSave(toPaise(price), backToList ? '' : reason.trim())}>
            Use this price
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <Input label="Price (₹)" inputMode="decimal" value={price} onChange={(e) => setPrice(e.target.value)} error={price && !valid ? 'Enter a price like 500' : null} hint={`Menu price: ${formatMoney(line.listUnitPrice)}`} />
        {!backToList && <Textarea label="Reason" placeholder="e.g. Shorter service than usual" value={reason} onChange={(e) => setReason(e.target.value)} />}
      </div>
    </Modal>
  );
}

function RejectModal({ loading, onClose, onReject }) {
  const [reason, setReason] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Turn down the discount"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={reason.trim().length < 2} loading={loading} onClick={() => onReject(reason.trim())}>
            Turn down
          </Button>
        </>
      }
    >
      <Textarea label="Reason (the front desk sees this)" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
