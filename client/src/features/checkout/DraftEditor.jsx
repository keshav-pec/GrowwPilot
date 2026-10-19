import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, Clock, Minus, Pencil, Plus, ShieldAlert, ShoppingBag, Trash2 } from 'lucide-react';
import { useAddProduct, useApproveDiscount, useDiscardDraft, useIssueInvoice, useQuote, useRejectDiscount, useRemoveLine, useRequestApproval, useSaveDraft } from '../../api/invoices';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { newRequestKey, percentLabel } from '../../lib/billing';
import { useDebounce } from '../../lib/useDebounce';
import { Button, Card, Input, Modal, Spinner, Textarea } from '../../components/ui';
import DiscountInput, { discountText, parseDiscount } from '../billing/DiscountInput';
import PaymentRows, { emptyPayment, paidTotal, paymentsPayload, rowsInvalid } from '../billing/PaymentRows';
import ProductPickerModal from '../billing/ProductPickerModal';

// What's in a line's boxes, starting from the saved line
const startingLine = (l) => ({ ...discountText(l.discountType, l.discountValue), unitPrice: l.unitPrice, reason: l.priceChangeReason ?? '', qty: l.qty });

// What's in the boxes, starting from the saved draft
function startingEdits(draft) {
  return {
    lines: Object.fromEntries(draft.lines.map((l) => [l._id, startingLine(l)])),
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
  const [picking, setPicking] = useState(false);
  const [advanceText, setAdvanceText] = useState('');
  const [keepExtra, setKeepExtra] = useState(false);

  const saveDraft = useSaveDraft();
  const issue = useIssueInvoice();
  const requestApproval = useRequestApproval();
  const approve = useApproveDiscount();
  const reject = useRejectDiscount();
  const addProduct = useAddProduct();
  const removeLine = useRemoveLine();
  const discard = useDiscardDraft();

  // Lines added since the screen opened (products) start from what was saved
  const lineEdit = (l) => edits.lines[l._id] ?? startingLine(l);

  // ----- What was typed -> what the server needs -----
  const parsedLines = draft.lines.map((l) => parseDiscount(lineEdit(l)));
  const parsedBill = parseDiscount(edits.bill);
  const inputError = parsedLines.some((p) => p.error) || Boolean(parsedBill.error);
  const payload = {
    billDiscount: parsedBill.value ?? null,
    lines: draft.lines.map((l, i) => {
      const e = lineEdit(l);
      return {
        lineId: l._id,
        discount: parsedLines[i].value ?? null,
        ...(l.kind === 'PRODUCT' && e.qty !== l.qty ? { qty: e.qty } : {}),
        ...(e.unitPrice !== l.unitPrice ? { unitPrice: e.unitPrice, priceChangeReason: e.reason } : {}),
      };
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
  // The customer's advance (money paid earlier) can pay part of the bill
  const advanceBalance = shown.advanceBalance ?? 0;
  const advanceValid = advanceText.trim() === '' || isValidRupees(advanceText);
  const advanceUse = advanceValid && advanceText.trim() ? toPaise(advanceText) : 0;
  const advanceError = !advanceValid ? 'Enter an amount' : advanceUse > advanceBalance ? `Only ${formatMoney(advanceBalance)} left` : advanceUse > total ? `The bill is ${formatMoney(total)}` : null;
  const due = total - advanceUse - paying;
  const extra = Math.max(-due, 0);
  // Products: not enough in the store blocks the issue (the server checks again)
  const shortOf = (l) => l.kind === 'PRODUCT' && shown.stock && lineEdit(l).qty > (shown.stock[l.skuId] ?? 0);
  const stockShort = draft.lines.some(shortOf);
  const limits = shown.limits ?? {};
  const approval = shown.approval ?? { status: 'NONE' };
  const permissions = shown.permissions ?? {};
  const canKeepExtra = extra > 0 && Boolean(draft.customerId);
  const canIssue = upToDate && draft.lines.length > 0 && !rowsInvalid(rows) && !advanceError && (due >= 0 || (canKeepExtra && keepExtra)) && !limits.needsApproval && !stockShort;
  const busy = saveDraft.isPending || issue.isPending || requestApproval.isPending || approve.isPending || reject.isPending || addProduct.isPending || removeLine.isPending;

  function setLine(line, change) {
    setEdits((current) => ({ ...current, lines: { ...current.lines, [line._id]: { ...(current.lines[line._id] ?? startingLine(line)), ...change } } }));
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
      { _id: draft._id, key, version: draft.version, ...payload, payments: paymentsPayload(rows), useAdvance: advanceUse, keepExtraAsAdvance: keepExtra && extra > 0 },
      handlers((invoice) => {
        toast.success(invoice.balanceDue > 0 ? `Bill ${invoice.invoiceNumber} issued · ${formatMoney(invoice.balanceDue)} due` : `Paid · ${invoice.invoiceNumber}`);
        navigate(`/app/invoices/${invoice._id}`);
      })
    );
  }

  const discountShare = (field) => shown.lines.reduce((sum, l) => sum + (l[field] ?? 0), 0);
  const lineDiscounts = discountShare('lineDiscount');
  const billDiscount = discountShare('billDiscountShare');
  const putting = paying + advanceUse;
  const payLabel = putting === 0 && total > 0 ? `Issue bill · ${formatMoney(total)} due` : due > 0 ? `Issue & pay ${formatMoney(putting)} · ${formatMoney(due)} due` : `Issue & pay ${formatMoney(total)}`;

  function addSku(sku) {
    addProduct.mutate(
      { _id: draft._id, version: draft.version, skuId: sku._id, qty: 1 },
      handlers(() => toast.success(`${sku.name} added`))
    );
  }

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card
        title="Bill"
        actions={
          <div className="flex items-center gap-2">
            {quote.isFetching && <Spinner size={16} />}
            {permissions.addProducts && (
              <Button size="sm" variant="secondary" onClick={() => setPicking(true)} disabled={busy}>
                <ShoppingBag size={14} /> Add product
              </Button>
            )}
          </div>
        }
      >
        {draft.lines.length === 0 && <p className="py-6 text-center text-sm text-muted">Nothing on the bill yet. Click “Add product”.</p>}
        <ul className="divide-y divide-border text-sm">
          {draft.lines.map((line, i) => {
            const now = shown.lines.find((l) => l._id === line._id) ?? line;
            const e = lineEdit(line);
            const changedPrice = e.unitPrice !== line.listUnitPrice;
            return (
              <li key={line._id} className="flex flex-col gap-2 py-3">
                <div className="flex justify-between gap-2">
                  <div>
                    <p className="font-medium">{line.name}</p>
                    <p className="text-xs text-muted">
                      {line.kind === 'PRODUCT' ? 'Product' : line.staffName}
                      {now.sacCode && ` · SAC ${now.sacCode}`}
                      {now.hsnCode && ` · HSN ${now.hsnCode}`}
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
                {line.kind === 'PRODUCT' && (
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1">
                      <Button size="sm" variant="secondary" aria-label="One less" disabled={e.qty <= 1} onClick={() => setLine(line, { qty: e.qty - 1 })}>
                        <Minus size={12} />
                      </Button>
                      <span className="w-8 text-center">{e.qty}</span>
                      <Button size="sm" variant="secondary" aria-label="One more" disabled={e.qty >= 999} onClick={() => setLine(line, { qty: e.qty + 1 })}>
                        <Plus size={12} />
                      </Button>
                      <span className={`ml-2 text-xs ${shortOf(line) ? 'font-medium text-danger' : 'text-muted'}`}>
                        {shown.stock ? `${shown.stock[line.skuId] ?? 0} in store` : ''}
                        {shortOf(line) && ' · not enough'}
                      </span>
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`Remove ${line.name}`}
                      disabled={busy}
                      onClick={() => removeLine.mutate({ _id: draft._id, version: draft.version, lineId: line._id }, handlers())}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                )}
                {now.comboDiscount > 0 && (
                  <div className="flex justify-between text-xs text-muted">
                    <span>Combo price</span>
                    <span>−{formatMoney(now.comboDiscount)}</span>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <DiscountInput value={e} onChange={(v) => setLine(line, { type: v.type, text: v.text })} error={parsedLines[i].error} label={`Discount on ${line.name}`} />
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
        {advanceBalance > 0 && total > 0 && (
          <div className="mb-4 flex flex-wrap items-start justify-between gap-2 rounded-lg bg-surface p-3 text-sm">
            <div>
              <p className="font-medium">Advance available: {formatMoney(advanceBalance)}</p>
              <button type="button" className="text-xs text-brown underline" onClick={() => setAdvanceText(String(Math.min(advanceBalance, total) / 100))}>
                Use {formatMoney(Math.min(advanceBalance, total))}
              </button>
            </div>
            <div className="w-32">
              <Input inputMode="decimal" placeholder="Use ₹" value={advanceText} onChange={(ev) => setAdvanceText(ev.target.value)} error={advanceError} aria-label="Advance to use" />
            </div>
          </div>
        )}
        {total === 0 ? <p className="text-sm text-muted">Nothing to pay.</p> : <PaymentRows rows={rows} onChange={setRows} total={Math.max(total - advanceUse, 0)} />}

        <div
          className={`mt-4 flex justify-between rounded-lg px-3 py-2 text-sm font-medium ${
            due < 0 ? 'bg-danger/10 text-danger' : due === 0 ? 'bg-brown/10 text-brown' : 'bg-orange/10 text-orange'
          }`}
        >
          <span>{due < 0 ? 'Too much by' : due === 0 ? 'Fully paid' : 'Will be due'}</span>
          <span>{formatMoney(Math.abs(due))}</span>
        </div>
        {canKeepExtra && (
          <label className="mt-2 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-gold" checked={keepExtra} onChange={(ev) => setKeepExtra(ev.target.checked)} />
            <span>Keep the extra {formatMoney(extra)} as an advance for {draft.customerSnapshot?.name}</span>
          </label>
        )}
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
        {!draft.appointmentId && (
          <Button
            variant="ghost"
            className="mt-2 w-full text-danger"
            disabled={busy}
            loading={discard.isPending}
            onClick={() =>
              discard.mutate(
                { _id: draft._id, version: draft.version },
                {
                  onSuccess: () => {
                    toast.success('Sale discarded');
                    navigate('/app/bills');
                  },
                  onError: (err) => toast.error(err.message),
                }
              )
            }
          >
            Discard this sale
          </Button>
        )}
      </Card>

      {picking && <ProductPickerModal onClose={() => setPicking(false)} onPick={addSku} busy={addProduct.isPending} />}

      {priceLine && (
        <PriceModal
          line={priceLine}
          current={lineEdit(priceLine)}
          onClose={() => setPriceLine(null)}
          onSave={(unitPrice, reason) => {
            setLine(priceLine, { unitPrice, reason });
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
