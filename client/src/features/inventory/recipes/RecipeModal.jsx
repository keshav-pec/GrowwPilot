import { useState } from 'react';
import toast from 'react-hot-toast';
import { DateTime } from 'luxon';
import { Trash2 } from 'lucide-react';
import { useAuth } from '../../../auth/AuthContext';
import { useEndRecipe, useRecipeHistory, useSaveRecipe } from '../../../api/inventory/recipes';
import { WAY_OF_USE_LABEL, describeRecipe, isMeasured, newRequestKey } from '../../../lib/inventory';
import { Badge, Button, ConfirmDialog, Input, Modal, Spinner, Tabs } from '../../../components/ui';
import { ProductPicker } from '../actions/fields';

// Only these are taken per service; finish-mode and by-hand products can only be linked (for reports)
const AUTOMATIC = ['SERVICE_UNITS', 'SERVICE_MEASURED'];
const when = (iso) => DateTime.fromISO(iso).toFormat('d LLL yyyy, h:mm a');

// One service's recipe: for all branches or just this one, its versions, and changing it
export default function RecipeModal({ row, can, onClose }) {
  const { user, activeBranch } = useAuth();
  const [scope, setScope] = useState(row.applies === 'branch' ? 'branch' : 'salon');
  const [editing, setEditing] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const endRecipe = useEndRecipe();
  const history = useRecipeHistory(row.service._id, scope);

  const part = row[scope]; // { current, upcoming }
  const canEdit = can['inventory.editRecipes'] && (scope === 'branch' || (user.role === 'OWNER' && user.allBranches));

  function stop() {
    endRecipe.mutate(
      { key: newRequestKey(), serviceId: row.service._id, scope },
      {
        onSuccess: () => {
          toast.success('Recipe stopped');
          setConfirmEnd(false);
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  return (
    <Modal open onClose={onClose} size="wide" title={`Recipe: ${row.service.name}`}>
      <Tabs
        tabs={[
          { value: 'salon', label: 'All branches' },
          { value: 'branch', label: `${activeBranch?.name} only` },
        ]}
        value={scope}
        onChange={(value) => {
          setScope(value);
          setEditing(false);
        }}
      />

      {editing ? (
        <RecipeForm service={row.service} scope={scope} start={part.current} onDone={() => setEditing(false)} />
      ) : (
        <>
          <p className="mb-3 text-sm text-muted">
            {scope === 'branch'
              ? `A recipe here is used at ${activeBranch?.name} instead of the one for all branches.`
              : 'Used at every branch that has no recipe of its own for this service.'}
            {row.applies === scope && (
              <span className="ml-2">
                <Badge tone="gold">Used at this branch now</Badge>
              </span>
            )}
          </p>

          {part.current ? (
            <RecipeLines recipe={part.current} />
          ) : (
            <p className="mb-4 rounded-lg border border-dashed border-border p-4 text-sm text-muted">No recipe {scope === 'branch' ? 'for this branch' : 'for all branches'} right now.</p>
          )}
          {part.upcoming.map((v) => (
            <div key={v._id} className="mb-4 rounded-lg bg-surface p-3 text-sm">
              <p className="font-medium">From {when(v.effectiveFrom)} (version {v.version})</p>
              <p className="text-muted">{describeRecipe(v)}</p>
            </div>
          ))}

          {canEdit && (
            <div className="mb-5 flex flex-wrap gap-2">
              <Button onClick={() => setEditing(true)}>{part.current ? 'Change recipe' : 'Set a recipe'}</Button>
              {part.current && part.upcoming.length === 0 && (
                <Button variant="ghost" onClick={() => setConfirmEnd(true)}>
                  Stop using it
                </Button>
              )}
            </div>
          )}

          <h3 className="mb-2 text-sm font-semibold text-brown">Earlier versions</h3>
          {history.isPending ? (
            <Spinner size={20} />
          ) : (history.data ?? []).filter((v) => v.effectiveTo && new Date(v.effectiveTo) <= new Date()).length === 0 ? (
            <p className="text-sm text-muted">None yet.</p>
          ) : (
            <ul className="divide-y divide-border rounded-lg border border-border text-sm">
              {history.data
                .filter((v) => v.effectiveTo && new Date(v.effectiveTo) <= new Date())
                .map((v) => (
                  <li key={v._id} className="px-3 py-2">
                    <p className="font-medium">
                      Version {v.version} · {when(v.effectiveFrom)} to {when(v.effectiveTo)}
                    </p>
                    <p className="text-muted">
                      {describeRecipe(v)} · set by {v.createdBy?.name}
                    </p>
                  </li>
                ))}
            </ul>
          )}
        </>
      )}

      <ConfirmDialog
        open={confirmEnd}
        onClose={() => setConfirmEnd(false)}
        onConfirm={stop}
        loading={endRecipe.isPending}
        title={`Stop the recipe for ${row.service.name}?`}
        message={
          scope === 'branch'
            ? 'From now on this branch uses the recipe for all branches (if there is one). Past services keep what they used.'
            : 'From now on this service takes no stock at branches without their own recipe. Past services keep what they used.'
        }
        confirmLabel="Stop it"
      />
    </Modal>
  );
}

function RecipeLines({ recipe }) {
  return (
    <div className="mb-4 overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-left text-sm">
        <thead className="bg-surface text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">Product</th>
            <th className="px-3 py-2 font-medium">Per service</th>
            <th className="px-3 py-2 font-medium">If no bottle is open</th>
          </tr>
        </thead>
        <tbody>
          {recipe.lines.length === 0 && (
            <tr>
              <td className="px-3 py-2 text-muted" colSpan={3}>
                Uses nothing.
              </td>
            </tr>
          )}
          {recipe.lines.map((l) => (
            <tr key={l._id} className="border-t border-border">
              <td className="px-3 py-2">{l.sku.name}</td>
              <td className="px-3 py-2">{l.deducts ? `${l.qty} ${isMeasured(l.sku) ? l.sku.baseUnit : `${l.sku.stockUnit}${l.qty === 1 ? '' : 's'}`}` : 'Linked only (not taken)'}</td>
              <td className="px-3 py-2 text-muted">{l.deducts && isMeasured(l.sku) ? (l.useStoreIfNeeded ? 'Take from the store' : 'Don’t take it') : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="px-3 py-2 text-xs text-muted">
        Version {recipe.version}, since {when(recipe.effectiveFrom)}, set by {recipe.createdBy?.name}
      </p>
    </div>
  );
}

// A new version: the products and amounts (typed by an owner, never suggested), and when it starts
function RecipeForm({ service, scope, start, onDone }) {
  const saveRecipe = useSaveRecipe();
  const [key] = useState(newRequestKey);
  const [lines, setLines] = useState(() =>
    (start?.lines ?? []).map((l) => ({ sku: l.sku, qty: l.qty ? String(l.qty) : '', deducts: l.deducts, useStoreIfNeeded: l.useStoreIfNeeded }))
  );
  const [picking, setPicking] = useState(lines.length === 0);
  const [startsLater, setStartsLater] = useState(false);
  const [startsAt, setStartsAt] = useState('');
  const [note, setNote] = useState('');

  const change = (i, changes) => setLines((all) => all.map((l, n) => (n === i ? { ...l, ...changes } : l)));

  function add(sku) {
    if (!lines.some((l) => l.sku._id === sku._id)) {
      setLines((all) => [...all, { sku, qty: '', deducts: AUTOMATIC.includes(sku.wayOfUse), useStoreIfNeeded: true }]);
    }
    setPicking(false);
  }

  const missingQty = lines.some((l) => l.deducts && !/^[1-9]\d*$/.test(l.qty));

  function save() {
    saveRecipe.mutate(
      {
        key,
        serviceId: service._id,
        scope,
        effectiveFrom: startsLater && startsAt ? DateTime.fromISO(startsAt).toISO() : undefined,
        note: note || undefined,
        lines: lines.map((l) => ({ skuId: l.sku._id, qty: l.deducts ? Number(l.qty) : null, deducts: l.deducts, useStoreIfNeeded: l.useStoreIfNeeded })),
      },
      {
        onSuccess: () => {
          toast.success('Recipe saved. Services completed from now on use it.');
          onDone();
        },
      }
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {lines.length > 0 && (
        <ul className="divide-y divide-border rounded-lg border border-border text-sm">
          {lines.map((l, i) => {
            const automatic = AUTOMATIC.includes(l.sku.wayOfUse);
            const unit = isMeasured(l.sku) ? l.sku.baseUnit : `${l.sku.stockUnit}s`;
            return (
              <li key={l.sku._id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                <div className="min-w-40 flex-1">
                  <p className="font-medium">{l.sku.name}</p>
                  <p className="text-xs text-muted">{WAY_OF_USE_LABEL[l.sku.wayOfUse]}</p>
                </div>
                {automatic ? (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" className="accent-gold" checked={l.deducts} onChange={(e) => change(i, { deducts: e.target.checked })} />
                    Take per service
                  </label>
                ) : (
                  <span className="text-xs text-muted">Linked only: it’s used up when marked finished, not per service</span>
                )}
                {l.deducts && (
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`${l.sku.name} per service`}
                      inputMode="numeric"
                      value={l.qty}
                      onChange={(e) => change(i, { qty: e.target.value.replace(/\D/g, '') })}
                      className="w-20 rounded-lg border border-border px-2 py-1 text-sm outline-none focus:border-gold"
                    />
                    <span>{unit}</span>
                  </div>
                )}
                {l.deducts && isMeasured(l.sku) && (
                  <label className="flex items-center gap-2 text-xs">
                    <input type="checkbox" className="accent-gold" checked={l.useStoreIfNeeded} onChange={(e) => change(i, { useStoreIfNeeded: e.target.checked })} />
                    If no bottle is open, take from the store
                  </label>
                )}
                <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={`Remove ${l.sku.name}`} onClick={() => setLines((all) => all.filter((_, n) => n !== i))}>
                  <Trash2 size={16} />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {picking ? (
        <ProductPicker label="Add a product" onPick={add} />
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setPicking(true)}>
          Add a product
        </Button>
      )}

      <div className="flex flex-wrap items-end gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input type="radio" className="accent-gold" checked={!startsLater} onChange={() => setStartsLater(false)} /> Starts now
        </label>
        <label className="flex items-center gap-2">
          <input type="radio" className="accent-gold" checked={startsLater} onChange={() => setStartsLater(true)} /> Starts later
        </label>
        {startsLater && <Input id="recipe-start" type="datetime-local" label="From" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />}
      </div>
      <Input id="recipe-note" label="Note (optional)" placeholder="e.g. New brand of colour" value={note} onChange={(e) => setNote(e.target.value)} />
      <p className="text-xs text-muted">Saving makes a new version. Services already completed keep the amounts they used.</p>
      {saveRecipe.isError && <p className="text-sm text-danger">{saveRecipe.error.message}</p>}

      <div className="flex justify-end gap-2">
        <Button variant="secondary" onClick={onDone}>
          Cancel
        </Button>
        <Button onClick={save} loading={saveRecipe.isPending} disabled={missingQty || (startsLater && !startsAt)}>
          Save recipe
        </Button>
      </div>
    </div>
  );
}
