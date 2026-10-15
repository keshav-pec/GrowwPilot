import { useState } from 'react';
import { DateTime } from 'luxon';
import { Badge, Button } from '../../../components/ui';
import { formatQty } from '../../../lib/inventory';
import FinishModal from '../actions/FinishModal';
import WriteOffModal from '../actions/WriteOffModal';
import ReportProblemModal from '../actions/ReportProblemModal';
import { MoveModal, ReturnModal } from '../actions/HandoutModals';

// Open hand-outs (In use, INV-06), with what each person may do with them:
// Finished, Return unused, Move to someone else, and Write off (or Report a problem for the front desk)
export default function HandoutsList({ handouts, can, showProduct = true }) {
  const [open, setOpen] = useState(null); // { action, handout }

  if (handouts.length === 0) return <p className="text-sm text-muted">Nothing handed out right now.</p>;

  const actions = [
    can['inventory.finish'] && ['finish', 'Finished'],
    can['inventory.return'] && ['return', 'Return'],
    can['inventory.transfer'] && ['move', 'Move'],
    can['inventory.writeOff'] ? ['writeOff', 'Write off'] : can['inventory.reportProblem'] && ['report', 'Report'],
  ].filter(Boolean);

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {handouts.map((h) => (
          <li key={h._id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <div>
              <p className="font-medium">
                {showProduct ? `${h.sku.name} · ` : ''}
                {h.recipient.name}
                {h.needsHandover && (
                  <span className="ml-2">
                    <Badge tone="danger">Needs handover</Badge>
                  </span>
                )}
              </p>
              <p className="text-xs text-muted">
                {formatQty(h.remainingQty, h.sku)} · out {DateTime.fromISO(h.createdAt).toRelative()}
              </p>
            </div>
            <div className="flex flex-wrap gap-1">
              {actions.map(([action, label]) => (
                <Button key={action} size="sm" variant={action === 'finish' ? 'secondary' : 'ghost'} onClick={() => setOpen({ action, handout: h })}>
                  {label}
                </Button>
              ))}
            </div>
          </li>
        ))}
      </ul>

      {open?.action === 'finish' && <FinishModal handout={open.handout} canReplace={can['inventory.issue']} onClose={() => setOpen(null)} />}
      {open?.action === 'return' && <ReturnModal handout={open.handout} onClose={() => setOpen(null)} />}
      {open?.action === 'move' && <MoveModal handout={open.handout} onClose={() => setOpen(null)} />}
      {open?.action === 'writeOff' && <WriteOffModal handout={open.handout} onClose={() => setOpen(null)} />}
      {open?.action === 'report' && <ReportProblemModal handout={open.handout} onClose={() => setOpen(null)} />}
    </>
  );
}
