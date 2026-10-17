import { useState } from 'react';
import toast from 'react-hot-toast';
import { DateTime } from 'luxon';
import { ClipboardCheck } from 'lucide-react';
import { useCountStep, useSaveCounts, useStartCount, useStockCounts } from '../../../api/inventory/stockCounts';
import { formatQty, isMeasured, newRequestKey } from '../../../lib/inventory';
import { Badge, Button, Card, EmptyState, Input, Modal, Spinner } from '../../../components/ui';

const when = (iso) => DateTime.fromISO(iso).toFormat('d LLL yyyy, h:mm a');
const unitOf = (sku) => (isMeasured(sku) ? sku.baseUnit : `${sku.stockUnit}s`);
const differs = (line, counted) => counted !== '' && counted != null && Number(counted) !== line.expected;

// Stock count: count the stores and each hand-out, give a reason for every difference, and an owner approves.
// Approved differences are posted as corrections; balances are never typed over.
export default function StockCountTab() {
  const countsQuery = useStockCounts();
  const start = useStartCount();

  if (countsQuery.isPending) return <Spinner size={24} />;
  if (countsQuery.isError) return <p className="text-sm text-danger">{countsQuery.error.message}</p>;
  const { current, past, canApprove } = countsQuery.data;

  return (
    <div className="grid gap-4">
      {current ? (
        current.status === 'COUNTING' ? (
          <Counting count={current} />
        ) : (
          <Review count={current} canApprove={canApprove} />
        )
      ) : (
        <EmptyState
          icon={ClipboardCheck}
          title="Count your stock"
          message="Starting a count notes what the records say right now. Then count each store and each hand-out; an owner approves the differences."
          action={
            <Button onClick={() => start.mutate({ key: newRequestKey() }, { onError: (err) => toast.error(err.message) })} loading={start.isPending}>
              Start a stock count
            </Button>
          }
        />
      )}

      {past.length > 0 && (
        <Card title="Earlier counts">
          <ul className="divide-y divide-border text-sm">
            {past.map((c) => (
              <li key={c._id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  {when(c.cutoffAt)}
                  {c.countedBy && ` · counted by ${c.countedBy.name}`}
                  {c.reviewedBy && ` · approved by ${c.reviewedBy.name}`}
                </span>
                <Badge tone={c.status === 'APPROVED' ? 'brown' : 'neutral'}>{c.status === 'APPROVED' ? 'Approved' : 'Cancelled'}</Badge>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}

function Counting({ count }) {
  const save = useSaveCounts();
  const step = useCountStep();
  const [values, setValues] = useState(() => Object.fromEntries(count.lines.map((l) => [l._id, { counted: l.counted ?? '', reason: l.reason ?? '' }])));
  const set = (id, changes) => setValues((v) => ({ ...v, [id]: { ...v[id], ...changes } }));

  const changedLines = () =>
    count.lines
      .filter((l) => String(values[l._id].counted) !== String(l.counted ?? '') || values[l._id].reason !== (l.reason ?? ''))
      .map((l) => ({ lineId: l._id, counted: values[l._id].counted === '' ? null : Number(values[l._id].counted), reason: values[l._id].reason }));

  async function saveProgress() {
    const lines = changedLines();
    if (lines.length > 0) await save.mutateAsync({ id: count._id, lines });
  }

  async function submit() {
    try {
      await saveProgress();
      await step.mutateAsync({ key: newRequestKey(), id: count._id, step: 'submit' });
      toast.success('Sent to an owner to review');
    } catch (err) {
      toast.error(err.message);
    }
  }

  const bad = count.lines.some((l) => !/^\d*$/.test(String(values[l._id].counted)));
  const counted = count.lines.filter((l) => values[l._id].counted !== '').length;
  const groups = [
    ['In the stores', count.lines.filter((l) => l.place === 'STORE')],
    ['Handed out (in use)', count.lines.filter((l) => l.place === 'HANDOUT')],
  ];

  return (
    <Card
      title={`Stock count started ${when(count.cutoffAt)}`}
      actions={
        <Button size="sm" variant="ghost" onClick={() => step.mutate({ key: newRequestKey(), id: count._id, step: 'cancel' }, { onError: (err) => toast.error(err.message) })}>
          Cancel count
        </Button>
      }
    >
      {count.reviewNote && <p className="mb-3 rounded-lg bg-yellow-soft px-3 py-2 text-sm">Sent back: {count.reviewNote}</p>}
      <p className="mb-4 text-sm text-muted">
        Type what you actually find. Leave a line empty if you didn’t count it (nothing changes for it). Every difference needs a reason. {counted} of {count.lines.length} counted.
      </p>

      {groups.map(
        ([title, lines]) =>
          lines.length > 0 && (
            <div key={title} className="mb-5">
              <h3 className="mb-2 text-sm font-semibold text-brown">{title}</h3>
              <div className="overflow-x-auto rounded-lg border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">Product</th>
                      <th className="px-3 py-2 font-medium">{title.startsWith('In the') ? 'Store' : 'Who has it'}</th>
                      <th className="px-3 py-2 font-medium">Records say</th>
                      <th className="px-3 py-2 font-medium">Counted</th>
                      <th className="px-3 py-2 font-medium">Why different</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const v = values[l._id];
                      return (
                        <tr key={l._id} className="border-t border-border align-top">
                          <td className="px-3 py-2 font-medium">{l.skuName}</td>
                          <td className="px-3 py-2">{l.locationName ?? l.heldBy}</td>
                          <td className="whitespace-nowrap px-3 py-2">{formatQty(l.expected, l.sku)}</td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <input
                                aria-label={`${l.skuName} counted`}
                                inputMode="numeric"
                                value={v.counted}
                                onChange={(e) => set(l._id, { counted: e.target.value.replace(/\D/g, '') })}
                                className="w-20 rounded-lg border border-border px-2 py-1 outline-none focus:border-gold"
                              />
                              <span className="text-xs text-muted">{unitOf(l.sku)}</span>
                            </div>
                          </td>
                          <td className="px-3 py-2">
                            {differs(l, v.counted) && (
                              <input
                                aria-label={`Why ${l.skuName} is different`}
                                value={v.reason}
                                placeholder="e.g. Broken bottle"
                                onChange={(e) => set(l._id, { reason: e.target.value })}
                                className={`w-full min-w-40 rounded-lg border px-2 py-1 outline-none focus:border-gold ${v.reason.trim() ? 'border-border' : 'border-danger'}`}
                              />
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )
      )}

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={() => saveProgress().then(() => toast.success('Saved'), (err) => toast.error(err.message))} loading={save.isPending} disabled={bad}>
          Save progress
        </Button>
        <Button onClick={submit} loading={step.isPending} disabled={bad}>
          Done: send for review
        </Button>
      </div>
    </Card>
  );
}

function Review({ count, canApprove }) {
  const step = useCountStep();
  const [sendingBack, setSendingBack] = useState(false);
  const changed = count.lines.filter((l) => l.counted != null && l.counted !== l.expected);

  function approve() {
    step.mutate({ key: newRequestKey(), id: count._id, step: 'approve' }, { onSuccess: () => toast.success('Approved. The differences are now in the stock.'), onError: (err) => toast.error(err.message) });
  }

  return (
    <Card title={`Stock count from ${when(count.cutoffAt)}: waiting for review`}>
      <p className="mb-3 text-sm text-muted">Counted by {count.countedBy?.name}.</p>
      {changed.length === 0 ? (
        <p className="mb-4 text-sm">Everything matched the records.</p>
      ) : (
        <ul className="mb-4 divide-y divide-border rounded-lg border border-border text-sm">
          {changed.map((l) => (
            <li key={l._id} className="px-3 py-2">
              <p className="font-medium">
                {l.skuName} · {l.locationName ?? l.heldBy}
              </p>
              <p className="text-xs text-muted">
                Records {formatQty(l.expected, l.sku)}, counted {formatQty(l.counted, l.sku)} ({l.counted > l.expected ? '+' : ''}
                {formatQty(l.counted - l.expected, l.sku)}) · {l.reason}
              </p>
            </li>
          ))}
        </ul>
      )}
      {canApprove ? (
        <div className="flex flex-wrap justify-end gap-2">
          <Button variant="secondary" onClick={() => setSendingBack(true)}>
            Send back to recount
          </Button>
          <Button onClick={approve} loading={step.isPending}>
            Approve {changed.length > 0 ? `${changed.length} difference${changed.length === 1 ? '' : 's'}` : 'count'}
          </Button>
        </div>
      ) : (
        <p className="text-sm text-muted">An owner will review it.</p>
      )}
      {sendingBack && <SendBackModal countId={count._id} onClose={() => setSendingBack(false)} />}
    </Card>
  );
}

function SendBackModal({ countId, onClose }) {
  const step = useCountStep();
  const [key] = useState(newRequestKey);
  const [note, setNote] = useState('');
  return (
    <Modal
      open
      onClose={onClose}
      title="Send back to recount"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            loading={step.isPending}
            disabled={note.trim().length < 3}
            onClick={() =>
              step.mutate(
                { key, id: countId, step: 'send-back', note },
                {
                  onSuccess: () => {
                    toast.success('Sent back');
                    onClose();
                  },
                }
              )
            }
          >
            Send back
          </Button>
        </>
      }
    >
      <Input id="count-sendback" label="What should be checked again?" autoFocus value={note} onChange={(e) => setNote(e.target.value)} />
      {step.isError && <p className="mt-2 text-sm text-danger">{step.error.message}</p>}
    </Modal>
  );
}
