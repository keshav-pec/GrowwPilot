import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { CheckCircle2, CircleAlert, Info } from 'lucide-react';
import { refusalText, useActivateGst, useSaveGstSetup } from '../../api/gst';
import { formatDateTime, formatMonth } from '../../lib/time';
import { newRequestKey } from '../../lib/requestKey';
import { Badge, Button, Card, ConfirmDialog, Input, Select } from '../../components/ui';
import ReasonModal from '../../components/ReasonModal';
import RegistrationsCard from './RegistrationsCard';
import TaxRulesCard from './TaxRulesCard';
import TestBillCard from './TestBillCard';

const SCHEMES = [
  { value: 'UNREGISTERED', label: 'Not registered', hint: 'Plain bills with no tax on them.' },
  { value: 'REGULAR', label: 'Regular', hint: 'Tax invoices with your GSTIN. Monthly returns.' },
  { value: 'COMPOSITION', label: 'Composition', unsupported: true },
  { value: 'QRMP', label: 'QRMP', unsupported: true },
];

// The Settings tab: registration type, registrations, tax rules, a test bill, then Activate.
// The business owner changes things; branch owners can look.
export default function GstSettingsTab({ setup }) {
  return (
    <div className="flex flex-col gap-4">
      {!setup.canEdit && <p className="rounded-lg bg-surface p-3 text-sm text-muted">Only the business owner can change GST setup.</p>}
      <Status setup={setup} />
      <SchemeCard key={`${setup.scheme}:${setup.startMonth}:${setup.pricesIncludeTax}`} setup={setup} />
      {setup.scheme === 'REGULAR' && (
        <>
          <RegistrationsCard setup={setup} />
          <TaxRulesCard setup={setup} />
          {setup.canEdit && <TestBillCard setup={setup} />}
        </>
      )}
      <p className="flex items-start gap-2 rounded-lg bg-yellow-soft p-3 text-xs">
        <Info size={14} className="mt-0.5 shrink-0" />
        Please have your GST practitioner check your tax rules, SAC and HSN codes and bill wording before you activate.
      </p>
    </div>
  );
}

// What is still needed, and the Activate button. Once active, only what needs attention is shown.
function Status({ setup }) {
  const activate = useActivateGst();
  const [confirming, setConfirming] = useState(false);
  if (setup.scheme !== 'REGULAR') return null;
  const problems = setup.checks.filter((c) => !c.ok);
  const shown = setup.active ? problems : setup.checks;

  function doActivate() {
    activate.mutate(
      { key: newRequestKey() },
      {
        onSuccess: () => {
          toast.success('GST setup is active');
          setConfirming(false);
        },
        onError: (err) => {
          toast.error(err.message);
          setConfirming(false);
        },
      }
    );
  }

  return (
    <Card
      title={setup.active ? 'Active' : 'Before you activate'}
      actions={!setup.active && setup.canEdit && (
        <Button disabled={problems.length > 0} onClick={() => setConfirming(true)}>
          Activate
        </Button>
      )}
    >
      {setup.active && (
        <p className="text-sm text-muted">
          Active since {formatDateTime(setup.activatedAt)}{setup.activatedByName && `, by ${setup.activatedByName}`}. New bills take their tax from your approved rules. Returns will start from {formatMonth(setup.startMonth)}.
        </p>
      )}
      {shown.length > 0 && (
        <ul className="mt-1 flex flex-col gap-2 text-sm">
          {shown.map((check) => (
            <li key={check.key} className="flex items-start gap-2">
              {check.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-brown" /> : <CircleAlert size={16} className="mt-0.5 shrink-0 text-orange" />}
              <span>
                {check.ok ? check.label : check.message}
                {!check.ok && check.link && check.link !== '/app/gst?tab=settings' && (
                  <>
                    {' '}
                    <Link to={check.link} className="font-medium underline">Fix it</Link>
                  </>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        onConfirm={doActivate}
        loading={activate.isPending}
        title="Activate GST setup"
        confirmLabel="Activate"
        message="Every bill issued from now on takes its tax from your approved rules and goes in the permanent tax record, and a bill with no approved rule can’t be issued. GST bills from your start month on are added to the record too. Bills already issued don’t change."
      />
    </Card>
  );
}

// Not registered or Regular, the start month, and how prices work
function SchemeCard({ setup }) {
  const save = useSaveGstSetup();
  const [scheme, setScheme] = useState(setup.scheme);
  const [startMonth, setStartMonth] = useState(setup.startMonth);
  const [pricesIncludeTax, setPricesIncludeTax] = useState(setup.pricesIncludeTax);
  const [askingReason, setAskingReason] = useState(false);

  function submit(reason) {
    save.mutate(
      { key: newRequestKey(), scheme, ...(scheme === 'REGULAR' && { startMonth, pricesIncludeTax }), ...(reason && { reason }) },
      {
        onSuccess: () => {
          toast.success('GST setup saved');
          setAskingReason(false);
        },
        onError: (err) => toast.error(refusalText(err)),
      }
    );
  }

  return (
    <Card
      title="Registration type"
      actions={setup.canEdit && (
        <Button size="sm" variant="secondary" loading={save.isPending} onClick={() => (scheme === 'UNREGISTERED' && setup.active ? setAskingReason(true) : submit())}>
          Save
        </Button>
      )}
    >
      <fieldset disabled={!setup.canEdit} className="flex flex-col gap-4 text-sm">
        <div className="grid gap-2 sm:grid-cols-2">
          {SCHEMES.map((option) => (
            <label key={option.value} className={`flex items-start gap-2 ${option.unsupported ? 'text-muted' : ''}`}>
              <input type="radio" name="gst-scheme" className="mt-1 accent-gold" disabled={option.unsupported} checked={scheme === option.value} onChange={() => setScheme(option.value)} />
              <span>
                <span className="font-medium">{option.label}</span> {option.unsupported && <Badge>Not supported</Badge>}
                {option.hint && <span className="block text-muted">{option.hint}</span>}
              </span>
            </label>
          ))}
        </div>
        {scheme === 'REGULAR' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Input label="Start month" type="month" min="2017-07" disabled={setup.active} hint="The first month your returns come from the app. Earlier months stay out." value={startMonth} onChange={(e) => setStartMonth(e.target.value)} />
            <Select
              label="Prices on your menu"
              options={[
                { value: 'yes', label: 'Include GST (₹1,050 menu price = what the customer pays)' },
                { value: 'no', label: 'Don’t include GST (GST is added on top)' },
              ]}
              value={pricesIncludeTax ? 'yes' : 'no'}
              onChange={(e) => setPricesIncludeTax(e.target.value === 'yes')}
            />
          </div>
        )}
      </fieldset>
      {askingReason && (
        <ReasonModal
          title="Stop using GST setup"
          message="New bills become plain bills with no tax. Bills already issued don’t change."
          confirmLabel="Stop"
          loading={save.isPending}
          onClose={() => setAskingReason(false)}
          onConfirm={submit}
        />
      )}
    </Card>
  );
}
