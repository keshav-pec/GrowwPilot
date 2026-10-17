import { useState } from 'react';
import toast from 'react-hot-toast';
import { ShieldCheck } from 'lucide-react';
import { fetchStockCheck, useInventorySettings, useSaveInventorySettings } from '../../../api/inventory/settings';
import { newRequestKey } from '../../../lib/inventory';
import { formatAmount, isValidRupees, toPaise } from '../../../lib/money';
import { Button, Card, Input, Spinner } from '../../../components/ui';
import LocationsCard from './LocationsCard';

// What the front desk may do (PRD launch defaults: only mark finished)
const FRONT_DESK = [
  ['finish', 'Mark bottles finished', 'Report empty bottles (and replace them, if they may also issue)'],
  ['issue', 'Issue and return stock', 'Hand products from the store to stylists and stations, and put unused ones back'],
  ['transfer', 'Move hand-outs', 'Move a product from one stylist or station to another'],
  ['receive', 'Receive deliveries', 'Receive stock against purchase orders'],
];

const LIMITS = [
  ['inventoryWriteOff', 'Inventory login: use and write off up to', 'Above this, they add a note and an owner approves.', false],
  ['branchOwnerWriteOff', 'Branch owner: use and write off up to', 'Above this, the business owner approves.', true],
  ['branchOwnerPoApproval', 'Branch owner: approve orders up to', 'Bigger orders go to the business owner.', true],
];

// Inventory settings (INV-15) for the selected branch. Owners only; the business owner alone decides
// branch owners' limits and whether they see costs.
export default function SettingsTab() {
  const settingsQuery = useInventorySettings();
  if (settingsQuery.isPending) return <Spinner size={24} />;
  if (settingsQuery.isError) return <p className="text-sm text-danger">{settingsQuery.error.message}</p>;
  const settings = settingsQuery.data;

  return (
    <div className="grid gap-4">
      <LocationsCard />
      <FrontDeskCard settings={settings} />
      <LimitsCard settings={settings} />
      <CheckCard />
    </div>
  );
}

function FrontDeskCard({ settings }) {
  const save = useSaveInventorySettings();

  function toggle(field, value) {
    save.mutate({ key: newRequestKey(), frontDesk: { [field]: value } }, { onSuccess: () => toast.success('Saved'), onError: (err) => toast.error(err.message) });
  }

  return (
    <Card title="What the front desk may do">
      <p className="mb-3 text-sm text-muted">The front desk can always see stock and report a problem. They never see costs or write stock off.</p>
      <ul className="divide-y divide-border text-sm">
        {FRONT_DESK.map(([field, label, hint]) => (
          <li key={field} className="flex items-start gap-3 py-2">
            <input
              id={`fd-${field}`}
              type="checkbox"
              className="mt-1 accent-gold"
              checked={settings.frontDesk[field]}
              disabled={save.isPending}
              onChange={(e) => toggle(field, e.target.checked)}
            />
            <label htmlFor={`fd-${field}`}>
              <span className="font-medium">{label}</span>
              <span className="block text-xs text-muted">{hint}</span>
            </label>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function LimitsCard({ settings }) {
  const save = useSaveInventorySettings();
  const [values, setValues] = useState(() => Object.fromEntries(LIMITS.map(([field]) => [field, String(settings.limits[field] / 100)])));
  const [seesCosts, setSeesCosts] = useState(settings.branchOwnerSeesCosts);
  const ownerRules = settings.canChangeOwnerRules;
  const valid = Object.values(values).every(isValidRupees);

  function saveAll() {
    const limits = Object.fromEntries(LIMITS.filter(([, , , ownerOnly]) => ownerRules || !ownerOnly).map(([field]) => [field, toPaise(values[field])]));
    save.mutate({ key: newRequestKey(), limits, ...(ownerRules && { branchOwnerSeesCosts: seesCosts }) }, { onSuccess: () => toast.success('Saved'), onError: (err) => toast.error(err.message) });
  }

  return (
    <Card title="Approval limits and costs">
      <div className="mb-4 grid gap-4 sm:grid-cols-3">
        {LIMITS.map(([field, label, hint, ownerOnly]) => (
          <Input
            key={field}
            id={`limit-${field}`}
            label={`${label} (₹)`}
            inputMode="decimal"
            hint={ownerOnly && !ownerRules ? `Set by the business owner: ${formatAmount(settings.limits[field])}` : hint}
            disabled={ownerOnly && !ownerRules}
            value={values[field]}
            error={!isValidRupees(values[field]) ? 'Enter an amount like 2000' : undefined}
            onChange={(e) => setValues((v) => ({ ...v, [field]: e.target.value }))}
          />
        ))}
      </div>
      <label className="mb-4 flex items-start gap-3 text-sm">
        <input type="checkbox" className="mt-1 accent-gold" checked={seesCosts} disabled={!ownerRules} onChange={(e) => setSeesCosts(e.target.checked)} />
        <span>
          <span className="font-medium">Branch owners see costs at their branches</span>
          <span className="block text-xs text-muted">{ownerRules ? 'Prices, stock value and cost reports.' : 'Only the business owner changes this.'}</span>
        </span>
      </label>
      <p className="mb-3 text-xs text-muted">A write-off or order whose value isn’t known (no price yet) always counts as above the limit.</p>
      <div className="flex justify-end">
        <Button onClick={saveAll} loading={save.isPending} disabled={!valid}>
          Save limits
        </Button>
      </div>
    </Card>
  );
}

// Rebuild every balance from the movement history and compare (should always match)
function CheckCard() {
  const [result, setResult] = useState(null);
  const [checking, setChecking] = useState(false);

  async function check() {
    setChecking(true);
    try {
      setResult(await fetchStockCheck());
    } catch (err) {
      toast.error(err.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <Card title="Check stock records">
      <p className="mb-3 text-sm text-muted">Adds up every stock movement from the start and compares it with the stock shown today. They should always match.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={check} loading={checking}>
          <ShieldCheck size={16} /> Run the check
        </Button>
        {result &&
          (result.ok ? (
            <span className="text-sm text-good">Everything matches the movement history.</span>
          ) : (
            <span className="text-sm text-danger">{result.mismatches.length} place(s) don’t match. Please contact GrowwPilot support.</span>
          ))}
      </div>
      {result && !result.ok && (
        <ul className="mt-3 text-sm">
          {result.mismatches.map((m, i) => (
            <li key={i}>
              {m.skuName} at {m.locationName}: shows {m.balance}, history says {m.history}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
