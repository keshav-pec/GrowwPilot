import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DateTime } from 'luxon';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, Download, Lock, RefreshCw } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useLockMonth, usePayrollMonth, useRecalculateMonth } from '../../api/payroll';
import { formatAmount } from '../../lib/money';
import { formatMonth } from '../../lib/payroll';
import { formatDateTime } from '../../lib/time';
import { Badge, Button, Card, EmptyState, Modal, Spinner, Table } from '../../components/ui';
import PayrollItemDrawer from './PayrollItemDrawer';
import GroupSwitch, { GROUPS, groupOf } from './GroupSwitch';

// Where to go to sort out each kind of "thing to check"
function fixLink(issue, item, onOpenPaySetup) {
  if (issue.code === 'NO_PAY_SETUP') return { label: 'Set up pay', onClick: () => onOpenPaySetup(item.staffId) };
  if (issue.code === 'ATTENDANCE_MISSING' || issue.code === 'MISSING_TIMES') return { label: 'Attendance', to: '/app/attendance' };
  if (issue.code === 'UNPAID_SERVICES') return { label: 'Appointments', to: '/app/appointments' };
  return null;
}

// A spreadsheet of the month, made in the browser
function downloadCsv(items, month, branchName) {
  const kinds = [
    ['salary', 'Salary'],
    ['daily', 'Days worked'],
    ['hourly', 'Hours worked'],
    ['per_service', 'Per service'],
    ['commission', 'Commission'],
    ['bonus', 'Bonuses'],
    ['deduction', 'Deductions'],
    ['advance', 'Advance repayments'],
  ];
  const rupees = (paise) => (paise / 100).toFixed(2);
  const sum = (item, kind) => item.lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.amount, 0);
  const quote = (v) => `"${String(v).replaceAll('"', '""')}"`;
  const rows = [
    ['Name', 'Section', 'Role', 'How paid', ...kinds.map(([, label]) => `${label} (Rs)`), 'Earnings (Rs)', 'To pay (Rs)'],
    ...items.map((i) => [i.staffName, GROUPS.find((g) => g.value === groupOf(i.staffKind)).label, i.staffRole ?? '', i.payDescription, ...kinds.map(([kind]) => rupees(sum(i, kind))), rupees(i.gross), rupees(i.net)]),
  ];
  const blob = new Blob([rows.map((r) => r.map(quote).join(',')).join('\n')], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `payroll-${branchName.toLowerCase().replace(/\s+/g, '-')}-${month}.csv`;
  link.click();
  URL.revokeObjectURL(link.href);
}

// Totals for one section (or the whole branch), from the month's lines
function addUp(items) {
  const lineSum = (kinds) => items.reduce((sum, i) => sum + i.lines.filter((l) => kinds.includes(l.kind)).reduce((s, l) => s + l.amount, 0), 0);
  return {
    count: items.length,
    gross: items.reduce((sum, i) => sum + i.gross, 0),
    net: items.reduce((sum, i) => sum + i.net, 0),
    deductions: items.reduce((sum, i) => sum + i.deductions, 0),
    commission: lineSum(['commission']),
    blocking: items.reduce((sum, i) => sum + i.issues.filter((x) => x.blocking).length, 0),
  };
}

const people = (n) => `${n} ${n === 1 ? 'person' : 'people'}`;

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="mt-1 text-xl font-semibold text-ink">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

function LockDialog({ month, run, items, onClose }) {
  const lock = useLockMonth();
  const [checked, setChecked] = useState(false);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Lock ${formatMonth(month)}?`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!checked}
            loading={lock.isPending}
            onClick={() =>
              lock.mutate(month, {
                onSuccess: () => {
                  toast.success(`${formatMonth(month)} is locked`);
                  onClose();
                },
              })
            }
          >
            <Lock size={16} /> Lock month
          </Button>
        </>
      }
    >
      <div className="space-y-3 text-sm">
        <p>
          <b>{run.totals.count}</b> {run.totals.count === 1 ? 'person' : 'people'}, <b>{formatAmount(run.totals.net)}</b> to pay in total.
        </p>
        <ul className="text-muted">
          {GROUPS.map((g) => {
            const t = addUp(items.filter((i) => groupOf(i.staffKind) === g.value));
            return (
              <li key={g.value}>
                {g.label}: {people(t.count)}, {formatAmount(t.net)}
              </li>
            );
          })}
        </ul>
        {run.totals.warnings > 0 && <p className="text-muted">{run.totals.warnings} thing(s) to check are only reminders and won’t stop the lock.</p>}
        <p className="rounded-lg bg-yellow-soft px-3 py-2">
          Once locked, these amounts can’t change. Any correction is added to a later month with a reason.
        </p>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={checked} onChange={(e) => setChecked(e.target.checked)} className="accent-gold" />
          I’ve checked these amounts
        </label>
        {lock.isError && <p className="text-danger">{lock.error.message}</p>}
      </div>
    </Modal>
  );
}

// Owners: the month's pay for everyone at the selected branch, in two sections (Staff, Front desk).
// The month is worked out and locked for the whole branch at once.
export default function MonthlyPayrollTab({ month, onMonthChange, group, onGroupChange, onOpenPaySetup }) {
  const { activeBranch } = useAuth();
  const monthQuery = usePayrollMonth(month);
  const recalculate = useRecalculateMonth();
  const [openStaffId, setOpenStaffId] = useState(null);
  const [locking, setLocking] = useState(false);

  const currentMonth = DateTime.now().setZone(activeBranch?.timezone).toFormat('yyyy-MM');
  const picker = (
    <input
      type="month"
      value={month}
      max={currentMonth}
      onChange={(e) => e.target.value && onMonthChange(e.target.value)}
      className="rounded-lg border border-border px-2 py-1.5 text-sm"
      aria-label="Month"
    />
  );

  if (monthQuery.isPending) return <Spinner size={24} />;
  if (monthQuery.isError) {
    return (
      <>
        <div className="mb-4">{picker}</div>
        <p className="text-sm text-danger">{monthQuery.error.message}</p>
      </>
    );
  }

  const { run, items, adjustments, payments, owedEarlier, today, monthOver, lastDay } = monthQuery.data;
  const locked = run.status === 'locked';
  const isFrontDeskGroup = group === 'front-desk';
  const sectionLabel = GROUPS.find((g) => g.value === group).label;
  const inGroup = (i) => groupOf(i.staffKind) === group;
  const sectionItems = items.filter(inGroup);
  const section = addUp(sectionItems);
  const otherBlocking = addUp(items.filter((i) => !inGroup(i))).blocking;
  const counts = { staff: 0, 'front-desk': 0 };
  for (const i of items) counts[groupOf(i.staffKind)] += 1;
  // Once locked, "things to check" are history: the amounts are final
  const withIssues = locked ? [] : sectionItems.filter((i) => i.issues.length > 0);
  const workedOut = DateTime.fromISO(run.calculatedAt);

  // Locked months: how much of each person's pay has been handed over
  const paidFor = (item) => payments.filter((p) => p.itemId === item._id && p.status === 'recorded').reduce((sum, p) => sum + p.amount, 0);
  const owedFor = (item) => Math.max(Math.max(item.net, 0) - paidFor(item), 0);
  const stillOwed = locked ? sectionItems.reduce((sum, i) => sum + owedFor(i), 0) : 0;
  const paidInSection = sectionItems.reduce((sum, i) => sum + paidFor(i), 0);
  const openItem = items.find((i) => i.staffId === openStaffId);

  const columns = [
    { key: 'name', header: 'Name', render: (i) => <span className="font-medium">{i.staffName}</span> },
    { key: 'pay', header: 'How they’re paid', render: (i) => <span className="text-muted">{i.payDescription}</span> },
    { key: 'gross', header: 'Earnings', render: (i) => formatAmount(i.gross) },
    { key: 'deductions', header: 'Deductions', render: (i) => (i.deductions ? `− ${formatAmount(i.deductions)}` : '—') },
    { key: 'net', header: 'To pay', render: (i) => <span className="font-semibold">{formatAmount(i.net)}</span> },
    ...(locked ? [{ key: 'paid', header: 'Paid', render: (i) => (paidFor(i) ? formatAmount(paidFor(i)) : '—') }] : []),
    {
      key: 'check',
      header: '',
      render: (i) =>
        locked ? (
          i.net <= 0 ? null : owedFor(i) === 0 ? <Badge tone="brown">Paid</Badge> : paidFor(i) ? <Badge tone="gold">Part paid</Badge> : <Badge tone="orange">Not paid</Badge>
        ) : i.issues.some((x) => x.blocking) ? <Badge tone="orange">Must fix</Badge> : i.issues.length > 0 ? <Badge tone="yellow">Check</Badge> : <CheckCircle2 size={16} className="text-good" />,
    },
  ];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        {picker}
        {locked ? <Badge tone="brown">Locked</Badge> : <Badge tone="gold">{monthOver ? 'Draft: ready to check' : 'Estimate so far'}</Badge>}
        {!locked && (
          <span className="text-xs text-muted">
            Worked out {workedOut.diffNow('minutes').minutes > -1 ? 'just now' : workedOut.toRelative()} ·{' '}
            <button type="button" className="inline-flex items-center gap-1 hover:text-ink" onClick={() => recalculate.mutate(month)} disabled={recalculate.isPending}>
              <RefreshCw size={12} className={recalculate.isPending ? 'animate-spin' : ''} /> Recalculate
            </button>
          </span>
        )}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => downloadCsv(items, month, activeBranch?.name ?? 'branch')} disabled={items.length === 0}>
            <Download size={16} /> Export
          </Button>
          {!locked && (
            <Button onClick={() => setLocking(true)} disabled={!monthOver || run.totals.blocking > 0}>
              <Lock size={16} /> Lock month
            </Button>
          )}
        </div>
      </div>

      {locked ? (
        <p className="mb-4 rounded-lg bg-surface px-4 py-3 text-sm">
          Locked by {run.lockedByName} on {formatDateTime(run.lockedAt, activeBranch?.timezone)}. These amounts can’t change; open a person to add a correction to a later month.
        </p>
      ) : !monthOver ? (
        <p className="mb-4 rounded-lg bg-surface px-4 py-3 text-sm text-muted">
          {formatMonth(month)} isn’t over yet, so this is an estimate based on what’s happened so far. You can lock it from {DateTime.fromISO(lastDay).toFormat('d LLL')}.
        </p>
      ) : (
        run.totals.blocking > 0 && (
          <p className="mb-4 rounded-lg bg-orange/10 px-4 py-3 text-sm">Sort out the things marked “Must fix” below, then lock the month.</p>
        )
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <GroupSwitch value={group} onChange={onGroupChange} counts={counts} />
        <span className="text-sm text-muted">
          Branch total: <span className="font-medium text-ink">{formatAmount(run.totals.net)}</span>
          {GROUPS.map((g) => ` · ${g.label} ${formatAmount(addUp(items.filter((i) => groupOf(i.staffKind) === g.value)).net)}`).join('')}
        </span>
      </div>

      {!locked && otherBlocking > 0 && (
        <p className="mb-4 rounded-lg bg-orange/10 px-4 py-3 text-sm">
          {GROUPS.find((g) => g.value !== group).label} also has {otherBlocking} thing(s) that must be fixed before the month can be locked.{' '}
          <button type="button" onClick={() => onGroupChange(GROUPS.find((g) => g.value !== group).value)} className="font-medium underline">
            Show them
          </button>
        </p>
      )}

      {owedEarlier.length > 0 && (
        <p className="mb-4 rounded-lg bg-orange/10 px-4 py-3 text-sm">
          Salary still owed from earlier months:{' '}
          {owedEarlier.map((o, index) => (
            <span key={o.month}>
              {index > 0 && ', '}
              <button type="button" onClick={() => onMonthChange(o.month)} className="font-medium underline">
                {formatMonth(o.month)}
              </button>{' '}
              {formatAmount(o.owed)}
            </span>
          ))}
        </p>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label={`${sectionLabel}: to pay`} value={formatAmount(section.net)} hint={people(section.count)} />
        {locked ? (
          <>
            <Stat label="Paid so far" value={formatAmount(paidInSection)} />
            <Stat label="Still owed" value={formatAmount(stillOwed)} hint={stillOwed === 0 ? 'Everyone is paid' : 'Open a person to record a payment'} />
          </>
        ) : (
          <>
            {isFrontDeskGroup ? (
              <Stat label="Earnings" value={formatAmount(section.gross)} hint="Before deductions" />
            ) : (
              <Stat label="Commission included" value={formatAmount(section.commission)} />
            )}
            <Stat label="Deductions" value={formatAmount(section.deductions)} />
          </>
        )}
        {locked ? (
          <Stat label="Locked by" value={run.lockedByName} hint={formatDateTime(run.lockedAt, activeBranch?.timezone)} />
        ) : (
          <Stat
            label="Things to check"
            value={sectionItems.reduce((sum, i) => sum + i.issues.length, 0)}
            hint={section.blocking ? `${section.blocking} must be fixed` : 'Nothing blocking'}
          />
        )}
      </div>

      {withIssues.length > 0 && (
        <Card title="Things to check" className="mb-6">
          <ul className="divide-y divide-border text-sm">
            {withIssues.flatMap((item) =>
              item.issues.map((issue) => {
                const fix = fixLink(issue, item, onOpenPaySetup);
                return (
                  <li key={`${item.staffId}-${issue.code}`} className="flex flex-wrap items-center gap-2 py-2">
                    <AlertTriangle size={16} className={issue.blocking ? 'text-orange' : 'text-muted'} />
                    <span className="font-medium">{item.staffName}:</span>
                    <span>{issue.message}</span>
                    {issue.blocking && <Badge tone="orange">Must fix</Badge>}
                    {fix &&
                      (fix.to ? (
                        <Link to={fix.to} className="ml-auto text-gold-dark hover:underline">
                          {fix.label} →
                        </Link>
                      ) : (
                        <button type="button" onClick={fix.onClick} className="ml-auto text-gold-dark hover:underline">
                          {fix.label} →
                        </button>
                      ))}
                  </li>
                );
              })
            )}
          </ul>
        </Card>
      )}

      <Table
        columns={columns}
        rows={sectionItems}
        rowKey="staffId"
        onRowClick={(i) => setOpenStaffId(i.staffId)}
        empty={
          <EmptyState
            title={isFrontDeskGroup ? 'No front desk pay this month' : 'Nobody to pay this month'}
            message={
              isFrontDeskGroup
                ? 'Add front desk members in Team (type “Front desk”) and set their salary in Pay setup.'
                : 'Set up how each person is paid in Pay setup, and they’ll appear here.'
            }
          />
        }
      />

      {openItem && (
        <PayrollItemDrawer
          item={openItem}
          month={month}
          locked={locked}
          adjustments={adjustments}
          payments={payments}
          today={today}
          onOpenPaySetup={() => {
            setOpenStaffId(null);
            onOpenPaySetup(openItem.staffId);
          }}
          onClose={() => setOpenStaffId(null)}
        />
      )}
      {locking && <LockDialog month={month} run={run} items={items} onClose={() => setLocking(false)} />}
    </>
  );
}
