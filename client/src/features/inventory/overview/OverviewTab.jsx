import { useState } from 'react';
import { AlertTriangle, ArrowRightLeft, ClipboardPen, Repeat2 } from 'lucide-react';
import { useOverview } from '../../../api/inventory/overview';
import { useHandouts } from '../../../api/inventory/allocations';
import { formatQty } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { Card, Spinner, StatTile } from '../../../components/ui';
import IssueModal from '../actions/IssueModal';
import FinishModal from '../actions/FinishModal';
import WriteOffModal from '../actions/WriteOffModal';
import ReportProblemModal from '../actions/ReportProblemModal';
import HandoutsList from './HandoutsList';
import RequestsCard from './RequestsCard';
import AutomationCard from './AutomationCard';

// Overview: quick actions, stock health, requests waiting, hand-outs and what to order
export default function OverviewTab({ can, onOpenProduct }) {
  const overviewQuery = useOverview();
  const handoutsQuery = useHandouts();
  const [action, setAction] = useState(null); // 'issue' | 'finish' | 'writeOff' | 'report'

  if (overviewQuery.isPending) return <Spinner size={24} />;
  if (overviewQuery.isError) return <p className="text-sm text-danger">{overviewQuery.error.message}</p>;
  const { totals, needToOrder, handover, automationIssues } = overviewQuery.data;
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

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <StatTile label="Products with stock in the store" value={`${totals.inStoreProducts} of ${totals.products}`} />
        <StatTile label="Handed out (in use)" value={totals.openHandouts} />
        {'stockValue' in totals && <StatTile label="Stock value" value={formatAmount(totals.stockValue)} />}
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

      {action === 'issue' && <IssueModal onClose={() => setAction(null)} />}
      {action === 'finish' && <FinishModal canReplace={can['inventory.issue']} onClose={() => setAction(null)} />}
      {action === 'writeOff' && <WriteOffModal onClose={() => setAction(null)} />}
      {action === 'report' && <ReportProblemModal onClose={() => setAction(null)} />}
    </div>
  );
}
