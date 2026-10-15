import { useMemo, useState } from 'react';
import toast from 'react-hot-toast';
import { AlertTriangle, CheckCircle2, XCircle } from 'lucide-react';
import { useCommitImport, usePreviewImport } from '../../../api/inventory/imports';
import { WAY_OF_USE_LABEL, newRequestKey } from '../../../lib/inventory';
import { IMPORT_COLUMNS } from '../../../lib/inventoryCsv';
import { Button, Input, Modal, Pagination } from '../../../components/ui';

const PAGE_SIZE = 100;

const STATUS_ICON = {
  ready: <CheckCircle2 size={18} className="text-good" aria-label="Ready" />,
  warning: <AlertTriangle size={18} className="text-orange" aria-label="Warning" />,
  error: <XCircle size={18} className="text-danger" aria-label="Must be fixed" />,
};

// "Check before saving": every row with ✅ ready, ⚠️ warning or ❌ must fix.
// Rows can be fixed here (then the whole file is checked again) or left out. Rows that must be fixed are never saved.
// batch: the server's check; rows: the file's rows as text (to edit and check again).
export default function ImportPreview({ batch, rows, fileName, onBatchChange, onCommitted, onCancel }) {
  const previewImport = usePreviewImport();
  const commitImport = useCommitImport();
  const key = useMemo(() => newRequestKey(), [batch._id]); // one per checked file: a double click imports once
  const [skipped, setSkipped] = useState(() => new Set());
  const [onlyProblems, setOnlyProblems] = useState(batch.counts.warning + batch.counts.error > 0);
  const [page, setPage] = useState(1);
  const [fixing, setFixing] = useState(null); // a row of the batch

  const shown = onlyProblems ? batch.rows.filter((r) => r.status !== 'ready') : batch.rows;
  const pages = Math.max(Math.ceil(shown.length / PAGE_SIZE), 1);
  const toImport = batch.rows.filter((r) => r.status !== 'error' && !skipped.has(r.row)).length;

  function toggleSkip(line) {
    setSkipped((current) => {
      const next = new Set(current);
      next.has(line) ? next.delete(line) : next.add(line);
      return next;
    });
  }

  // Check the whole file again (after a fix, or when something changed on the server)
  function checkAgain(nextRows) {
    previewImport.mutate(
      { fileName, rows: nextRows },
      {
        onSuccess: (nextBatch) => {
          onBatchChange({ batch: nextBatch, rows: nextRows });
          setFixing(null);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  function saveFix(line, raw) {
    checkAgain(rows.map((r, i) => (i + 2 === line ? raw : r))); // line 1 is the header
  }

  function commit() {
    commitImport.mutate({ key, id: batch._id, skipRows: [...skipped] }, { onSuccess: onCommitted });
  }

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <span className="flex items-center gap-1">{STATUS_ICON.ready} {batch.counts.ready} ready</span>
        <span className="flex items-center gap-1">{STATUS_ICON.warning} {batch.counts.warning} with warnings</span>
        <span className="flex items-center gap-1">{STATUS_ICON.error} {batch.counts.error} must be fixed</span>
        <label className="ml-auto flex items-center gap-2">
          <input
            type="checkbox"
            className="accent-gold"
            checked={onlyProblems}
            onChange={(e) => {
              setOnlyProblems(e.target.checked);
              setPage(1);
            }}
          />
          Only rows with problems
        </label>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border">
        <table className="w-full text-left text-sm">
          <thead className="bg-surface text-muted">
            <tr>
              {['Import', 'Row', '', 'Name', 'Category', 'Unit', 'Way of use', 'Opening', 'What to check', ''].map((h, i) => (
                <th key={i} className="whitespace-nowrap px-3 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE).map((r) => (
              <tr key={r.row} className={`border-t border-border align-top ${skipped.has(r.row) || r.status === 'error' ? 'text-muted' : ''}`}>
                <td className="px-3 py-2">
                  <input
                    type="checkbox"
                    className="accent-gold"
                    aria-label={`Import row ${r.row}`}
                    disabled={r.status === 'error'}
                    checked={r.status !== 'error' && !skipped.has(r.row)}
                    onChange={() => toggleSkip(r.row)}
                  />
                </td>
                <td className="px-3 py-2">{r.row}</td>
                <td className="px-3 py-2">{STATUS_ICON[r.status]}</td>
                <td className="px-3 py-2 font-medium">{r.raw.name || '—'}</td>
                <td className="px-3 py-2">{r.raw.category || '—'}</td>
                <td className="px-3 py-2">{r.raw.stock_unit || '—'}</td>
                <td className="px-3 py-2">{WAY_OF_USE_LABEL[r.values.wayOfUse] ?? (r.raw.way_of_use || '—')}</td>
                <td className="px-3 py-2">{r.raw.opening_qty || '—'}</td>
                <td className="min-w-56 px-3 py-2">
                  {r.problems.map((p, i) => (
                    <p key={i} className={p.level === 'error' ? 'text-danger' : 'text-orange'}>
                      {p.message}
                    </p>
                  ))}
                </td>
                <td className="px-3 py-2">
                  {r.status !== 'ready' && (
                    <Button size="sm" variant="ghost" onClick={() => setFixing(r)}>
                      Fix
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Pagination page={page} pages={pages} onChange={setPage} />

      {commitImport.isError && (
        <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-danger">
          {commitImport.error.message}
          {commitImport.error.code === 'IMPORT_CHANGED' && (
            <Button size="sm" variant="secondary" onClick={() => checkAgain(rows)} loading={previewImport.isPending}>
              Check again
            </Button>
          )}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        {batch.counts.error > 0 && <p className="mr-auto text-xs text-muted">Rows that must be fixed are left out unless you fix them.</p>}
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button onClick={commit} loading={commitImport.isPending} disabled={toImport === 0}>
          {toImport === 1 ? 'Import 1 product' : `Import ${toImport} products`}
        </Button>
      </div>

      {fixing && <FixRowModal line={fixing} saving={previewImport.isPending} onSave={(raw) => saveFix(fixing.row, raw)} onClose={() => setFixing(null)} />}
    </div>
  );
}

// Change one row's cells, then the file is checked again
function FixRowModal({ line, saving, onSave, onClose }) {
  const [raw, setRaw] = useState(line.raw);
  const problemFor = (column, level) => line.problems.find((p) => p.field === column && p.level === level)?.message;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Fix row ${line.row}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onSave(raw)} loading={saving}>
            Check again
          </Button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        {IMPORT_COLUMNS.map((column) => (
          <Input
            key={column}
            id={`fix-${column}`}
            label={column}
            value={raw[column] ?? ''}
            error={problemFor(column, 'error')}
            hint={problemFor(column, 'warning')}
            onChange={(e) => setRaw((r) => ({ ...r, [column]: e.target.value }))}
          />
        ))}
      </div>
    </Modal>
  );
}
