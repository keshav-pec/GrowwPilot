import { useState } from 'react';
import toast from 'react-hot-toast';
import { useAuth } from '../../../auth/AuthContext';
import { useSetSkuStatus, useSku, useSkuMovements, useUseSkuHere } from '../../../api/inventory/skus';
import { useHandouts } from '../../../api/inventory/allocations';
import { useCorrectFinish } from '../../../api/inventory/movements';
import { SKU_TYPE_LABEL, WAY_OF_USE_LABEL, costPerStockUnit, formatQty, isMeasured, movementLabel, newRequestKey } from '../../../lib/inventory';
import { formatAmount } from '../../../lib/money';
import { formatDateTime } from '../../../lib/time';
import { Badge, Button, ConfirmDialog, Drawer, Input, Modal, Pagination, Spinner } from '../../../components/ui';
import ProductFormModal from './ProductFormModal';
import HandoutsList from '../overview/HandoutsList';
import IssueModal from '../actions/IssueModal';
import WriteOffModal from '../actions/WriteOffModal';
import ReportProblemModal from '../actions/ReportProblemModal';

function Section({ title, children }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-sm font-semibold text-brown">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm font-semibold text-ink">{value}</p>
    </div>
  );
}

// Product page (INV-04): stock per place at this branch, hand-outs, details and the full movement history
export default function ProductDrawer({ skuId, categories, can, onClose }) {
  const skuQuery = useSku(skuId);
  const handoutsQuery = useHandouts(skuId);
  const canSeeCosts = can['inventory.viewCosts'];
  const [action, setAction] = useState(null); // 'issue' | 'writeOff' | 'report'
  const setStatus = useSetSkuStatus();
  const useHere = useUseSkuHere();
  const [editing, setEditing] = useState(null); // null | 'all' | 'reorder'
  const [confirmStatus, setConfirmStatus] = useState(false);

  const data = skuQuery.data;
  const sku = data?.sku;

  function changeStatus() {
    const status = sku.status === 'active' ? 'inactive' : 'active';
    setStatus.mutate(
      { key: newRequestKey(), _id: sku._id, version: sku.version, status },
      {
        onSuccess: () => {
          setConfirmStatus(false);
          toast.success(status === 'inactive' ? `${sku.name} deactivated` : `${sku.name} is active again`);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  function startUsingHere() {
    useHere.mutate({ key: newRequestKey(), _id: sku._id }, { onSuccess: () => toast.success(`${sku.name} is now used at this branch`), onError: (err) => toast.error(err.message) });
  }

  const footer = data && (data.canEdit || data.canSetReorder) && (
    <>
      {data.canEdit && (
        <Button variant="ghost" className="mr-auto" onClick={() => setConfirmStatus(true)}>
          {sku.status === 'active' ? 'Deactivate' : 'Reactivate'}
        </Button>
      )}
      {data.usedHere && (
        <Button variant="secondary" onClick={() => setEditing(data.canEdit ? 'all' : 'reorder')}>
          {data.canEdit ? 'Edit' : 'Reorder levels'}
        </Button>
      )}
    </>
  );

  return (
    <Drawer open onClose={onClose} title={sku?.name ?? 'Product'} footer={footer}>
      {skuQuery.isPending ? (
        <Spinner size={24} />
      ) : skuQuery.isError ? (
        <p className="text-sm text-danger">{skuQuery.error.message}</p>
      ) : (
        <>
          <p className="text-sm text-muted">
            {sku.code} · {sku.category}
            {sku.brand && ` · ${sku.brand}`}
          </p>
          <div className="mb-5 mt-2 flex flex-wrap gap-2">
            <Badge tone="brown">{WAY_OF_USE_LABEL[sku.wayOfUse]}</Badge>
            {sku.status === 'inactive' && <Badge>Inactive</Badge>}
            {data.totals.needToOrder && <Badge tone="orange">Need to order</Badge>}
          </div>

          {!data.usedHere ? (
            <div className="mb-5 rounded-lg border border-dashed border-border p-4 text-sm">
              <p className="mb-3 text-muted">This product isn’t used at this branch yet.</p>
              {data.canSetReorder && (
                <Button size="sm" onClick={startUsingHere} loading={useHere.isPending}>
                  Use it at this branch
                </Button>
              )}
            </div>
          ) : (
            <>
              <Section title="Stock at this branch">
                <div className="grid grid-cols-2 gap-2">
                  <Stat label="In store" value={formatQty(data.totals.inStore, sku)} />
                  <Stat label="In use" value={formatQty(data.totals.inUse, sku)} />
                  <Stat label="Available to issue" value={formatQty(data.totals.available, sku)} />
                  <Stat
                    label="Order more at"
                    value={data.branch.reorderPoint == null ? 'Not set' : formatQty(data.branch.reorderPoint, sku)}
                  />
                  {canSeeCosts && (
                    <>
                      <Stat label="Stock value" value={data.branch.value == null ? 'No cost yet' : formatAmount(data.branch.value)} />
                      <Stat
                        label={`Average cost per ${sku.stockUnit}`}
                        value={data.branch.avgCost == null ? 'No cost yet' : formatAmount(costPerStockUnit(data.branch.avgCost, sku))}
                      />
                    </>
                  )}
                </div>
              </Section>

              <Section title="Where it is">
                <ul className="divide-y divide-border rounded-lg border border-border text-sm">
                  {data.balances.map((b) => (
                    <li key={b.locationId} className="flex justify-between px-3 py-2">
                      <span>{b.name}</span>
                      <span className="font-medium">{formatQty(b.qty, sku)}</span>
                    </li>
                  ))}
                </ul>
              </Section>

              {sku.status === 'active' && (
                <div className="mb-5 flex flex-wrap gap-2">
                  {can['inventory.issue'] && data.totals.available > 0 && (
                    <Button size="sm" onClick={() => setAction('issue')}>
                      Issue
                    </Button>
                  )}
                  {can['inventory.writeOff'] ? (
                    <Button size="sm" variant="secondary" onClick={() => setAction('writeOff')}>
                      Use or write off
                    </Button>
                  ) : (
                    can['inventory.reportProblem'] && (
                      <Button size="sm" variant="secondary" onClick={() => setAction('report')}>
                        Report a problem
                      </Button>
                    )
                  )}
                </div>
              )}

              <Section title="Handed out">
                {handoutsQuery.isPending ? <Spinner size={20} /> : <HandoutsList handouts={handoutsQuery.data ?? []} can={can} showProduct={false} />}
              </Section>
            </>
          )}

          <Section title="Details">
            <dl className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted">Type</dt>
                <dd>{SKU_TYPE_LABEL[sku.type]}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted">Counted in</dt>
                <dd>{isMeasured(sku) ? `${sku.baseUnit} (${sku.unitsPerStockUnit} ${sku.baseUnit} per ${sku.stockUnit})` : `${sku.stockUnit}s`}</dd>
              </div>
              <div className="col-span-2">
                <dt className="text-xs text-muted">Barcodes</dt>
                <dd>{sku.barcodes.length ? sku.barcodes.join(', ') : '—'}</dd>
              </div>
            </dl>
          </Section>

          <Section title="Movement history">
            <MovementHistory sku={sku} showCosts={canSeeCosts} canCorrect={can['inventory.correctFinish']} />
          </Section>
        </>
      )}

      {action === 'issue' && <IssueModal sku={sku} onClose={() => setAction(null)} />}
      {action === 'writeOff' && <WriteOffModal sku={sku} onClose={() => setAction(null)} />}
      {action === 'report' && <ReportProblemModal sku={sku} onClose={() => setAction(null)} />}
      {editing && (
        <ProductFormModal product={data} categories={categories} canSeeCosts={canSeeCosts} reorderOnly={editing === 'reorder'} onClose={() => setEditing(null)} />
      )}
      {sku && (
        <ConfirmDialog
          open={confirmStatus}
          onClose={() => setConfirmStatus(false)}
          onConfirm={changeStatus}
          loading={setStatus.isPending}
          danger={sku.status === 'active'}
          title={sku.status === 'active' ? `Deactivate ${sku.name}?` : `Reactivate ${sku.name}?`}
          message={
            sku.status === 'active'
              ? 'It disappears from the product list. Its stock and full history are kept, and you can reactivate it any time.'
              : 'It shows in the product list again.'
          }
          confirmLabel={sku.status === 'active' ? 'Deactivate' : 'Reactivate'}
        />
      )}
    </Drawer>
  );
}

// Every change to this product's stock at the branch (INV-13), newest first. Nothing here can be edited.
function MovementHistory({ sku, showCosts, canCorrect }) {
  const { activeBranch } = useAuth();
  const [page, setPage] = useState(1);
  const [correcting, setCorrecting] = useState(null); // a FINISH movement to undo
  const historyQuery = useSkuMovements(sku._id, page);

  if (historyQuery.isPending) return <Spinner size={20} />;
  if (historyQuery.isError) return <p className="text-sm text-danger">{historyQuery.error.message}</p>;
  const { items, pages } = historyQuery.data;
  if (items.length === 0) return <p className="text-sm text-muted">No stock movements yet.</p>;

  return (
    <>
      <ul className="divide-y divide-border rounded-lg border border-border text-sm">
        {items.map((m) => (
          <li key={m._id} className="px-3 py-2">
            <div className="flex justify-between gap-2">
              <span className="font-medium">
                {movementLabel(m)} · {m.location.name}
              </span>
              <span className={`whitespace-nowrap font-semibold ${m.qty > 0 ? 'text-good' : 'text-danger'}`}>
                {m.qty > 0 ? '+' : ''}
                {formatQty(m.qty, sku)}
              </span>
            </div>
            <p className="mt-0.5 text-xs text-muted">
              {formatDateTime(m.occurredAt, activeBranch?.timezone)} · {m.actorName} ({m.actorRole})
              {m.heldBy && ` · held by ${m.heldBy.name}`}
              {showCosts && m.unitCost != null && ` · ${formatAmount(costPerStockUnit(m.unitCost, sku))} per ${sku.stockUnit}`}
            </p>
            {m.note && <p className="mt-0.5 text-xs text-ink">{m.note}</p>}
            {canCorrect && m.type === 'FINISH' && (
              <button type="button" className="mt-1 text-xs text-brown underline" onClick={() => setCorrecting(m)}>
                Finished by mistake? Undo
              </button>
            )}
          </li>
        ))}
      </ul>
      <Pagination page={page} pages={pages} onChange={setPage} />
      {correcting && <CorrectFinishModal movement={correcting} sku={sku} onClose={() => setCorrecting(null)} />}
    </>
  );
}

// Owners: a finish made by mistake is undone with a correction that points at it. Nothing is deleted.
function CorrectFinishModal({ movement, sku, onClose }) {
  const correct = useCorrectFinish();
  const [key] = useState(newRequestKey);
  const [note, setNote] = useState('');

  function save() {
    correct.mutate(
      { key, transactionId: movement.transactionId, note },
      {
        onSuccess: () => {
          toast.success(`${formatQty(-movement.qty, sku)} is back with ${movement.heldBy?.name ?? 'the hand-out'}`);
          onClose();
        },
      }
    );
  }

  return (
    <Modal
      open
      onClose={onClose}
      title="Undo a finish"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={save} loading={correct.isPending} disabled={note.trim().length < 3}>
            Undo finish
          </Button>
        </>
      }
    >
      <p className="mb-3 text-sm text-muted">
        {formatQty(-movement.qty, sku)} goes back into the hand-out it came from. The original entry stays in the history, with this correction next to it.
      </p>
      <Input id="correct-note" label="What went wrong" autoFocus placeholder="e.g. Marked the wrong bottle" value={note} onChange={(e) => setNote(e.target.value)} />
      {correct.isError && <p className="mt-2 text-sm text-danger">{correct.error.message}</p>}
    </Modal>
  );
}
