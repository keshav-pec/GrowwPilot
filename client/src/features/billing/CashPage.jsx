import { useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle } from 'lucide-react';
import { useAddPettyCash, useAdjustCashDay, useCashDay, useCloseCashDay, useOpenCashDay } from '../../api/cash';
import { formatMoney, isValidRupees, toPaise } from '../../lib/money';
import { formatDateTime, formatDay } from '../../lib/time';
import { newRequestKey } from '../../lib/billing';
import { Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner, Table, Textarea } from '../../components/ui';

// Rupees typed in a box -> paise, or null if it isn't an amount
const paiseOf = (text) => (isValidRupees(text) ? toPaise(text) : null);
const signed = (paise) => `${paise < 0 ? '−' : paise > 0 ? '+' : ''}${formatMoney(Math.abs(paise))}`;

// The daily cash drawer at the selected branch: open with a float, petty cash, count and close.
// Cash payments and cash refunds of the day are counted automatically.
export default function CashPage() {
  const cashQuery = useCashDay();
  const [adjusting, setAdjusting] = useState(null); // a closed day

  if (cashQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (cashQuery.isError) return <EmptyState title="Couldn’t load the cash drawer" message={cashQuery.error.message} />;
  const { branch, today, session, suggestedFloat, cashSoFar, recent, permissions } = cashQuery.data;

  return (
    <>
      <PageHeader title="Cash drawer" subtitle={`${branch.name} · ${formatDay(today)}`} />

      {!session && <OpenDay suggestedFloat={suggestedFloat} cashSoFar={cashSoFar} />}
      {session?.status === 'OPEN' && <OpenSession session={session} today={today} canClose={permissions.close} />}
      {session?.status === 'CLOSED' && <ClosedDay day={session} zone={branch.timezone} canAdjust={permissions.adjust} onAdjust={() => setAdjusting(session)} />}

      <h2 className="mb-2 mt-8 font-semibold text-brown">Recent days</h2>
      <Table
        rowKey="_id"
        rows={recent}
        columns={[
          { key: 'day', header: 'Day', render: (d) => formatDay(d.day) },
          { key: 'float', header: 'Float', render: (d) => formatMoney(d.openingFloat) },
          { key: 'in', header: 'Cash in', render: (d) => formatMoney(d.cashIn) },
          { key: 'out', header: 'Cash out', render: (d) => formatMoney(d.cashOut + d.pettyOut - d.pettyIn) },
          { key: 'expected', header: 'Expected', render: (d) => formatMoney(d.expectedCash) },
          { key: 'counted', header: 'Counted', render: (d) => formatMoney(d.countedCash) },
          { key: 'difference', header: 'Difference', render: (d) => <Difference value={d.differenceAfterAdjustments} adjusted={d.adjustments !== 0} /> },
          { key: 'by', header: 'Closed by', render: (d) => d.closedByName },
          ...(permissions.adjust ? [{ key: 'adjust', header: '', render: (d) => <Button size="sm" variant="ghost" onClick={() => setAdjusting(d)}>Adjust</Button> }] : []),
        ]}
        empty={<EmptyState title="No closed days yet" />}
      />

      {adjusting && <AdjustModal day={adjusting} onClose={() => setAdjusting(null)} />}
    </>
  );
}

function Difference({ value, adjusted = false }) {
  if (value === 0) return <span className="text-brown">Matches{adjusted && ' (adjusted)'}</span>;
  return <span className={value < 0 ? 'font-medium text-danger' : 'font-medium text-orange'}>{signed(value)} {value < 0 ? 'short' : 'over'}{adjusted && ' (adjusted)'}</span>;
}

function OpenDay({ suggestedFloat, cashSoFar }) {
  const [float, setFloat] = useState(String(suggestedFloat / 100));
  const [key] = useState(newRequestKey);
  const open = useOpenCashDay();
  const amount = paiseOf(float);
  return (
    <Card title="Open today’s cash day">
      <p className="mb-3 text-sm text-muted">Count the cash in the drawer before the first customer and enter it as the float.{cashSoFar > 0 && ` ${formatMoney(cashSoFar)} in cash has already been taken today; it will be counted.`}</p>
      <div className="flex flex-wrap items-start gap-2">
        <div className="w-40">
          <Input label="Float (₹)" inputMode="decimal" value={float} onChange={(e) => setFloat(e.target.value)} error={amount === null ? 'Enter an amount' : null} />
        </div>
        <Button className="mt-6" disabled={amount === null} loading={open.isPending} onClick={() => open.mutate({ key, openingFloat: amount }, { onSuccess: () => toast.success('Cash day opened'), onError: (err) => toast.error(err.message) })}>
          Open cash day
        </Button>
      </div>
    </Card>
  );
}

function Figures({ day }) {
  const rows = [
    ['Float', formatMoney(day.openingFloat)],
    ['Cash received', `+${formatMoney(day.cashIn)}`],
    ['Cash handed back (refunds)', `−${formatMoney(day.cashOut)}`],
    ['Petty cash in', `+${formatMoney(day.pettyIn)}`],
    ['Petty cash out', `−${formatMoney(day.pettyOut)}`],
  ];
  return (
    <dl className="flex flex-col gap-1 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="flex justify-between">
          <dt className="text-muted">{label}</dt>
          <dd>{value}</dd>
        </div>
      ))}
      <div className="flex justify-between border-t border-border pt-2 text-lg font-bold text-brown">
        <dt>Expected in the drawer</dt>
        <dd>{formatMoney(day.expectedCash)}</dd>
      </div>
    </dl>
  );
}

function Movements({ movements }) {
  if (!movements?.length) return null;
  const words = { PETTY_IN: 'Petty cash in', PETTY_OUT: 'Petty cash out', ADJUSTMENT: 'Adjustment' };
  return (
    <ul className="mt-4 divide-y divide-border text-sm">
      {movements.map((m) => (
        <li key={m._id} className="flex justify-between gap-2 py-1.5">
          <span>
            {words[m.kind]}: {m.reason} <span className="text-xs text-muted">· {m.byName}</span>
          </span>
          <span>{m.kind === 'PETTY_OUT' ? `−${formatMoney(m.amount)}` : signed(m.amount)}</span>
        </li>
      ))}
    </ul>
  );
}

function OpenSession({ session, today, canClose }) {
  const [petty, setPetty] = useState({ kind: 'PETTY_OUT', amount: '', reason: '' });
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [pettyKey, setPettyKey] = useState(newRequestKey);
  const [closeKey] = useState(newRequestKey);
  const addPetty = useAddPettyCash();
  const close = useCloseCashDay();

  const pettyAmount = paiseOf(petty.amount);
  const countedAmount = paiseOf(counted);
  const difference = countedAmount === null ? null : countedAmount - session.expectedCash;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card title={session.day === today ? 'Today' : `Cash day of ${formatDay(session.day)}`} actions={<Badge tone="gold">Open</Badge>}>
        {session.day !== today && (
          <p className="mb-3 flex items-center gap-2 rounded-lg bg-orange/10 p-2 text-sm text-orange">
            <AlertTriangle size={16} /> This day was never closed. Count the drawer and close it to start today.
          </p>
        )}
        <Figures day={session} />
        <Movements movements={session.movements} />
        <p className="mt-3 text-xs text-muted">Opened by {session.openedByName}. Cash payments and cash refunds are added by themselves.</p>
      </Card>

      <div className="flex flex-col gap-4">
        <Card title="Petty cash">
          <div className="grid gap-2 sm:grid-cols-[8rem_7rem_1fr]">
            <Select aria-label="In or out" options={[{ value: 'PETTY_OUT', label: 'Out' }, { value: 'PETTY_IN', label: 'In' }]} value={petty.kind} onChange={(e) => setPetty((p) => ({ ...p, kind: e.target.value }))} />
            <Input aria-label="Amount" inputMode="decimal" placeholder="₹" value={petty.amount} onChange={(e) => setPetty((p) => ({ ...p, amount: e.target.value }))} />
            <Input aria-label="What for" placeholder="What for? e.g. Tea and milk" value={petty.reason} onChange={(e) => setPetty((p) => ({ ...p, reason: e.target.value }))} />
          </div>
          <Button
            size="sm"
            variant="secondary"
            className="mt-2"
            disabled={!pettyAmount || petty.reason.trim().length < 3}
            loading={addPetty.isPending}
            onClick={() =>
              addPetty.mutate(
                { _id: session._id, key: pettyKey, kind: petty.kind, amount: pettyAmount, reason: petty.reason.trim() },
                {
                  onSuccess: () => {
                    setPetty({ kind: 'PETTY_OUT', amount: '', reason: '' });
                    setPettyKey(newRequestKey());
                  },
                  onError: (err) => toast.error(err.message),
                }
              )
            }
          >
            Add petty cash
          </Button>
        </Card>

        <Card title="Count and close">
          {canClose ? (
            <>
              <Input label="Cash counted in the drawer (₹)" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} error={counted && countedAmount === null ? 'Enter an amount' : null} />
              {difference !== null && (
                <p className="mt-2 text-sm">
                  <Difference value={difference} />
                </p>
              )}
              {difference !== null && difference !== 0 && <Textarea className="mt-2" label="Why is there a difference?" value={note} onChange={(e) => setNote(e.target.value)} />}
              <Button
                className="mt-3 w-full"
                disabled={countedAmount === null || (difference !== 0 && note.trim().length < 3)}
                loading={close.isPending}
                onClick={() =>
                  close.mutate(
                    { _id: session._id, key: closeKey, countedCash: countedAmount, note: note.trim() || undefined, version: session.version },
                    { onSuccess: () => toast.success('Cash day closed'), onError: (err) => toast.error(err.message) }
                  )
                }
              >
                Close cash day
              </Button>
            </>
          ) : (
            <p className="text-sm text-muted">An owner closes the cash day at this branch.</p>
          )}
        </Card>
      </div>
    </div>
  );
}

function ClosedDay({ day, zone, canAdjust, onAdjust }) {
  return (
    <Card title="Today is closed" actions={canAdjust && <Button size="sm" variant="secondary" onClick={onAdjust}>Add adjustment</Button>}>
      <div className="grid gap-6 lg:grid-cols-2">
        <Figures day={day} />
        <dl className="flex flex-col gap-1 text-sm">
          <div className="flex justify-between">
            <dt className="text-muted">Counted</dt>
            <dd>{formatMoney(day.countedCash)}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-muted">Difference</dt>
            <dd>
              <Difference value={day.difference} />
            </dd>
          </div>
          {day.adjustments !== 0 && (
            <div className="flex justify-between">
              <dt className="text-muted">After adjustments</dt>
              <dd>
                <Difference value={day.differenceAfterAdjustments} />
              </dd>
            </div>
          )}
          {day.closeNote && <p className="mt-1 text-muted">“{day.closeNote}”</p>}
          <p className="mt-1 text-xs text-muted">
            Closed by {day.closedByName} · {formatDateTime(day.closedAt, zone)}
          </p>
        </dl>
      </div>
      {day.lateCash !== 0 && (
        <p className="mt-3 flex items-center gap-2 rounded-lg bg-orange/10 p-2 text-sm text-orange">
          <AlertTriangle size={16} /> {formatMoney(day.lateCash)} in cash was taken after closing. It is not in the counted figures{canAdjust && '; add an adjustment if it stayed in the drawer'}.
        </p>
      )}
      <Movements movements={day.movements} />
    </Card>
  );
}

// Owners: a correction to a closed day, e.g. a cash payment that was recorded as UPI
function AdjustModal({ day, onClose }) {
  const [direction, setDirection] = useState('1');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [key] = useState(newRequestKey);
  const adjust = useAdjustCashDay();
  const value = paiseOf(amount);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Adjust the cash day of ${formatDay(day.day)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!value || reason.trim().length < 3}
            loading={adjust.isPending}
            onClick={() =>
              adjust.mutate(
                { _id: day._id, key, amount: Number(direction) * value, reason: reason.trim() },
                {
                  onSuccess: () => {
                    toast.success('Adjustment added');
                    onClose();
                  },
                  onError: (err) => toast.error(err.message),
                }
              )
            }
          >
            Add adjustment
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">A closed day is never changed. The adjustment is added next to it, with your reason.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select
          label="The drawer should have had"
          options={[
            { value: '1', label: 'More cash than expected' },
            { value: '-1', label: 'Less cash than expected' },
          ]}
          value={direction}
          onChange={(e) => setDirection(e.target.value)}
        />
        <Input label="Amount (₹)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </div>
      <Textarea className="mt-3" label="Reason" placeholder="e.g. ₹500 paid by UPI was recorded as cash" value={reason} onChange={(e) => setReason(e.target.value)} />
    </Modal>
  );
}
