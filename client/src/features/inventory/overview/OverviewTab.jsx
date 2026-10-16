import { useState } from 'react';
import { DateTime } from 'luxon';
import { AlertTriangle, ArrowRightLeft, ClipboardPen, Repeat2 } from 'lucide-react';
import { useOverview } from '../../../api/inventory/overview';
import { useHandouts } from '../../../api/inventory/allocations';
import { formatQty, movementLabel } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { Card, Spinner } from '../../../components/ui';
import IssueModal from '../actions/IssueModal';
import FinishModal from '../actions/FinishModal';
import WriteOffModal from '../actions/WriteOffModal';
import ReportProblemModal from '../actions/ReportProblemModal';
import HandoutsList from './HandoutsList';
import RequestsCard from './RequestsCard';
import AutomationCard from './AutomationCard';

function Stat({ label, value, tone = 'text-brown' }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className={`text-2xl font-bold ${tone}`}>{value}</p>
    </div>
  );
}

// Overview (INV-01): quick actions, stock health, requests waiting, hand-outs, what to order, recent activity
export default function OverviewTab({ can, onOpenProduct }) {
  const overviewQuery = useOverview();
  const handoutsQuery = useHandouts();
  const [action, setAction] = useState(null); // 'issue' | 'finish' | 'writeOff' | 'report'

  if (overviewQuery.isPending) return <Spinner size={24} />;
  if (overviewQuery.isError) return <p className="text-sm text-danger">{overviewQuery.error.message}</p>;
  const { totals, needToOrder, handover, recent, automationIssues } = overviewQuery.data;
  const handlesRequests = can['inventory.writeOff'];

  const quickActions = [
    can['inventory.issue'] && ['issue', 'Issue product', ArrowRightLeft],
    can['inventory.finish'] && ['finish', 'Mark finished', Repeat2],
    handlesRequests ? ['writeOff', 'Adjust stock', ClipboardPen] : can['inventory.reportProblem'] && ['report', 'Report a problem', AlertTriangle],
  ].filter(Boolean);

  return (
    <div className="grid gap-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {quickActions.map(([key, label, Icon]) => (
          <button
            key={key}
            type="button"
            onClick={() => setAction(key)}
            className="flex items-center justify-center gap-3 rounded-xl bg-gold px-4 py-4 text-base font-semibold text-ink shadow-sm hover:bg-gold-dark"
          >
            <Icon size={22} /> {label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Products with stock in the store" value={`${totals.inStoreProducts} of ${totals.products}`} />
        <Stat label="Handed out (in use)" value={totals.openHandouts} />
        <Stat label="Need to order" value={totals.needToOrder} tone={totals.needToOrder > 0 ? 'text-orange' : 'text-brown'} />
        {'stockValue' in totals && <Stat label="Stock value" value={formatAmount(totals.stockValue)} />}
      </div>

      <RequestsCard handlesRequests={handlesRequests} />
      {automationIssues > 0 && <AutomationCard can={can} />}

      {handover.length > 0 && (
        <Card title="Needs handing over" className="border-danger/40">
          <p className="mb-2 text-sm text-muted">These people no longer work here. Move what they had to someone else.</p>
          <HandoutsList handouts={handover} can={can} />
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="In use">
          {handoutsQuery.isPending ? <Spinner size={20} /> : <HandoutsList handouts={(handoutsQuery.data ?? []).filter((h) => !h.needsHandover)} can={can} />}
        </Card>

        <Card title="Need to order">
          {needToOrder.length === 0 ? (
            <p className="text-sm text-muted">Nothing is below its reorder level.</p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {needToOrder.map((n) => (
                <li key={n.sku._id}>
                  <button type="button" onClick={() => onOpenProduct(n.sku._id)} className="flex w-full justify-between gap-2 py-2 text-left hover:text-brown">
                    <span className="font-medium">{n.sku.name}</span>
                    <span className="text-muted">
                      {formatQty(n.available, n.sku)} left · order at {formatQty(n.reorderPoint, n.sku)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={can['inventory.writeOff'] ? 'Recent activity' : 'What you did recently'}>
        {recent.length === 0 ? (
          <p className="text-sm text-muted">No stock movements yet.</p>
        ) : (
          <ul className="divide-y divide-border text-sm">
            {recent.map((t) => (
              <li key={t._id} className="py-2">
                <p>
                  <span className="font-medium">{movementLabel(t)}</span>
                  {' · '}
                  {summarizeLines(t)}
                </p>
                <p className="text-xs text-muted">
                  {t.actorName}
                  {t.heldBy && ` · ${t.heldBy.name}`} · {DateTime.fromISO(t.occurredAt).toRelative()}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {action === 'issue' && <IssueModal onClose={() => setAction(null)} />}
      {action === 'finish' && <FinishModal canReplace={can['inventory.issue']} onClose={() => setAction(null)} />}
      {action === 'writeOff' && <WriteOffModal onClose={() => setAction(null)} />}
      {action === 'report' && <ReportProblemModal onClose={() => setAction(null)} />}
    </div>
  );
}

// "1 bottle of Shampoo": a movement's size, counted once (moves have a minus and a plus line of the same size)
function summarizeLines(t) {
  const line = t.lines.find((l) => l.qty > 0) ?? t.lines[0];
  if (!line?.sku) return '';
  return `${formatQty(Math.abs(line.qty), line.sku)} of ${line.sku.name}`;
}
