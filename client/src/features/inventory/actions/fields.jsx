import { useState } from 'react';
import { Search } from 'lucide-react';
import { useSkus } from '../../../api/inventory/skus';
import { useLocations } from '../../../api/inventory/locations';
import { useRecipients } from '../../../api/inventory/allocations';
import { useDebounce } from '../../../lib/useDebounce';
import { formatQty, isMeasured, recipientValue } from '../../../lib/inventory';
import { Input, Select } from '../../../components/ui';
import Field, { fieldClass } from '../../../components/ui/Field';

// Small form pieces shared by the stock action popups (issue, finish, return, move, write off, report).

// A whole quantity. Measured products (counted in ml / g) are typed as full bottles plus an open amount.
// value and onChange are in the product's counting unit.
export function QtyField({ sku, label = 'How many', value, onChange, error }) {
  if (!isMeasured(sku)) {
    return (
      <Input
        label={`${label} (${sku.stockUnit}s)`}
        inputMode="numeric"
        value={value === 0 ? '' : String(value)}
        onChange={(e) => onChange(/^\d*$/.test(e.target.value) ? Number(e.target.value || 0) : value)}
        error={error}
      />
    );
  }
  const per = sku.unitsPerStockUnit;
  const whole = Math.floor(value / per);
  const loose = value % per;
  const set = (w, l) => onChange(w * per + l);
  const digits = (text, fallback) => (/^\d*$/.test(text) ? Number(text || 0) : fallback);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Input label={`${label}: full ${sku.stockUnit}s`} inputMode="numeric" value={whole === 0 ? '' : String(whole)} onChange={(e) => set(digits(e.target.value, whole), loose)} error={error} />
      <Input label={`Plus (${sku.baseUnit})`} inputMode="numeric" value={loose === 0 ? '' : String(loose)} onChange={(e) => set(whole, Math.min(digits(e.target.value, loose), per - 1))} />
    </div>
  );
}

// Find a product at this branch by name, code or barcode (a scanner works too)
export function ProductPicker({ label = 'Product', onPick, onlyInStore = false }) {
  const [search, setSearch] = useState('');
  const debounced = useDebounce(search.trim());
  const skusQuery = useSkus({ search: debounced || undefined, status: 'active', scope: 'branch', page: 1 });
  const rows = (skusQuery.data?.rows ?? []).filter((r) => !onlyInStore || r.inStore > 0).slice(0, 8);

  return (
    <Field label={label} id="product-search">
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input
          id="product-search"
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && rows.length === 1) {
              e.preventDefault();
              onPick(rows[0]);
            }
          }}
          placeholder="Search by name, code, or scan a barcode"
          className={`${fieldClass()} pl-9`}
        />
      </div>
      <ul className="mt-2 max-h-64 divide-y divide-border overflow-y-auto rounded-lg border border-border text-sm">
        {rows.length === 0 ? (
          <li className="px-3 py-2 text-muted">{skusQuery.isPending ? 'Loading…' : onlyInStore ? 'No product with stock in the store matches.' : 'No product matches.'}</li>
        ) : (
          rows.map((r) => (
            <li key={r._id}>
              <button type="button" onClick={() => onPick(r)} className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-yellow-soft">
                <span>
                  <span className="font-medium">{r.name}</span> <span className="text-xs text-muted">{r.code}</span>
                </span>
                <span className="whitespace-nowrap text-muted">{formatQty(r.inStore, r)} in store</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </Field>
  );
}

// The stores of this branch (open ones), e.g. for where to take stock from or return it to
export function StoreSelect({ label = 'Store', value, onChange }) {
  const locationsQuery = useLocations();
  const stores = (locationsQuery.data ?? []).filter((l) => l.kind === 'STORE' && l.active);
  return <Select label={label} options={stores.map((s) => ({ value: s._id, label: s.name }))} value={value ?? ''} onChange={(e) => onChange(e.target.value)} />;
}

// Who gets it: the salon floor, a station or a team member. value: 'FLOOR' | 'STATION:<id>' | 'STAFF:<id>'
export function RecipientSelect({ label = 'Who gets it', value, onChange, error }) {
  const { data } = useRecipients();
  return (
    <Field label={label} error={error} id="recipient">
      <select id="recipient" className={fieldClass(error)} value={value ?? ''} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose…</option>
        <option value="FLOOR">Salon floor</option>
        {data?.stations.length > 0 && (
          <optgroup label="Stations">
            {data.stations.map((s) => (
              <option key={s._id} value={recipientValue({ kind: 'STATION', id: s._id })}>
                {s.name}
              </option>
            ))}
          </optgroup>
        )}
        {data?.staff.length > 0 && (
          <optgroup label="Team">
            {data.staff.map((s) => (
              <option key={s._id} value={recipientValue({ kind: 'STAFF', id: s._id })}>
                {s.name} ({s.role})
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </Field>
  );
}
