import { useState } from 'react';
import { Link } from 'react-router-dom';
import toast from 'react-hot-toast';
import { Info } from 'lucide-react';
import { useBillingSettings, useSaveBillingSettings } from '../../api/billing';
import { GST_RATE_OPTIONS, GST_STATES, newRequestKey, percentLabel } from '../../lib/billing';
import { Button, Card, EmptyState, Input, PageHeader, Select, Spinner } from '../../components/ui';

// The current financial year, for the bill number example: "26-27"
function currentFy() {
  const now = new Date();
  const start = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  return `${String(start % 100).padStart(2, '0')}-${String((start + 1) % 100).padStart(2, '0')}`;
}
const GSTIN_SHAPE = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

// Billing settings (owners): GST registration, how prices work, the front desk discount limit, and each
// branch's GSTIN and bill prefix. Only the business owner can change them; branch owners can look.
export default function BillingSettingsPage() {
  const settingsQuery = useBillingSettings();
  if (settingsQuery.isPending) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size={28} />
      </div>
    );
  }
  if (settingsQuery.isError) return <EmptyState title="Couldn’t load billing settings" message={settingsQuery.error.message} />;
  return <SettingsForm key={settingsQuery.data.updatedAt ?? 'new'} saved={settingsQuery.data} />;
}

function SettingsForm({ saved }) {
  const save = useSaveBillingSettings();
  const [key, setKey] = useState(newRequestKey);
  const [values, setValues] = useState({
    legalName: saved.legalName,
    gstRegistered: saved.gstRegistered,
    pricesIncludeTax: saved.pricesIncludeTax,
    defaultServiceTaxBps: String(saved.defaultServiceTaxBps),
    defaultSacCode: saved.defaultSacCode,
    discountLimit: String(saved.frontDeskDiscountLimitBps / 100),
    guestProductSales: saved.guestProductSales,
  });
  const [branches, setBranches] = useState(saved.branches.map((b) => ({ ...b, invoicePrefix: b.prefixIsSaved ? b.invoicePrefix : '', autoPrefix: b.invoicePrefix })));
  const canEdit = saved.canEdit;
  const set = (field) => (e) => setValues((v) => ({ ...v, [field]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }));
  const setBranch = (index, change) => setBranches((rows) => rows.map((row, i) => (i === index ? { ...row, ...change } : row)));

  const limit = Number(values.discountLimit);
  const limitError = !/^\d+(\.\d{1,2})?$/.test(values.discountLimit.trim()) || limit > 100 ? 'A percentage from 0 to 100' : null;
  const legalError = values.gstRegistered && !values.legalName.trim() ? 'Needed on GST bills' : null;
  const branchErrors = branches.map((b) => ({
    gstin: b.gstin && !GSTIN_SHAPE.test(b.gstin) ? '15 characters, like 27AAKCG4821M1Z5' : null,
    prefix: b.invoicePrefix && !/^[A-Z0-9]{1,4}$/.test(b.invoicePrefix) ? '1 to 4 letters or digits' : null,
  }));
  const hasErrors = limitError || legalError || branchErrors.some((e) => e.gstin || e.prefix) || (values.defaultSacCode && !/^\d{4,8}$/.test(values.defaultSacCode));

  function submit(e) {
    e.preventDefault();
    save.mutate(
      {
        key,
        legalName: values.legalName.trim(),
        gstRegistered: values.gstRegistered,
        pricesIncludeTax: values.pricesIncludeTax,
        defaultServiceTaxBps: Number(values.defaultServiceTaxBps),
        defaultSacCode: values.defaultSacCode.trim(),
        frontDeskDiscountLimitBps: Math.round(limit * 100),
        guestProductSales: values.guestProductSales,
        branches: branches.map((b) => ({ branchId: b.branchId, gstin: b.gstin, stateCode: b.stateCode, invoicePrefix: b.invoicePrefix })),
      },
      {
        onSuccess: () => {
          setKey(newRequestKey());
          toast.success('Billing settings saved');
        },
        onError: (err) => toast.error(err.message),
      }
    );
  }

  const fy = currentFy();
  return (
    <form onSubmit={submit} noValidate>
      <PageHeader
        title="Billing settings"
        subtitle={<Link to="/app/bills" className="hover:underline">← Bills</Link>}
        actions={
          canEdit && (
            <Button type="submit" disabled={hasErrors} loading={save.isPending}>
              Save settings
            </Button>
          )
        }
      />
      {!canEdit && <p className="mb-4 rounded-lg bg-surface p-3 text-sm text-muted">Only the business owner can change billing settings.</p>}

      <fieldset disabled={!canEdit} className="flex flex-col gap-4">
        <Card title="GST">
          <div className="flex flex-col gap-4 text-sm">
            <div className="flex flex-col gap-2">
              <label className="flex items-start gap-2">
                <input type="radio" name="gst" className="mt-1 accent-gold" checked={!values.gstRegistered} onChange={() => setValues((v) => ({ ...v, gstRegistered: false }))} />
                <span>
                  <span className="font-medium">Not GST registered</span>
                  <span className="block text-muted">Plain bills with no tax on them.</span>
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input type="radio" name="gst" className="mt-1 accent-gold" checked={values.gstRegistered} onChange={() => setValues((v) => ({ ...v, gstRegistered: true }))} />
                <span>
                  <span className="font-medium">GST registered</span>
                  <span className="block text-muted">Tax invoices with your GSTIN, CGST and SGST. (The composition scheme isn’t supported yet.)</span>
                </span>
              </label>
            </div>

            {values.gstRegistered && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Input label="Legal name (as on your GST registration)" value={values.legalName} onChange={set('legalName')} error={legalError} placeholder={saved.salonName} />
                <Select
                  label="Prices on your menu"
                  options={[
                    { value: 'yes', label: 'Include GST (₹1,180 menu price = what the customer pays)' },
                    { value: 'no', label: 'Don’t include GST (GST is added on top)' },
                  ]}
                  value={values.pricesIncludeTax ? 'yes' : 'no'}
                  onChange={(e) => setValues((v) => ({ ...v, pricesIncludeTax: e.target.value === 'yes' }))}
                />
                <Select label="GST rate for services" hint="Used when a service has no rate of its own (set in Services & combos)" options={GST_RATE_OPTIONS} value={values.defaultServiceTaxBps} onChange={set('defaultServiceTaxBps')} />
                <Input label="SAC code for services (optional)" hint="e.g. 999721 for hair, 999722 for beauty treatments" inputMode="numeric" value={values.defaultSacCode} onChange={set('defaultSacCode')} error={values.defaultSacCode && !/^\d{4,8}$/.test(values.defaultSacCode) ? '4 to 8 digits' : null} />
              </div>
            )}
            <p className="flex items-start gap-2 rounded-lg bg-yellow-soft p-3 text-xs">
              <Info size={14} className="mt-0.5 shrink-0" />
              Please have your tax adviser check the GST rate, SAC codes and bill wording before you start issuing GST bills.
            </p>
          </div>
        </Card>

        <Card title="Discounts and sales">
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <Input
              label="Front desk discount limit (% of the bill)"
              hint={`Above ${limitError ? 'this' : percentLabel(Math.round(limit * 100))}, an owner has to approve the discount first`}
              inputMode="decimal"
              value={values.discountLimit}
              onChange={set('discountLimit')}
              error={limitError}
            />
            <label className="flex items-start gap-2 sm:pt-6">
              <input type="checkbox" className="mt-1 accent-gold" checked={values.guestProductSales} onChange={set('guestProductSales')} />
              <span>
                <span className="font-medium">Allow product sales without a customer (“Guest”)</span>
                <span className="block text-muted">Used when product sales arrive. Services always need a customer.</span>
              </span>
            </label>
          </div>
        </Card>

        <Card title="Branches">
          <div className="flex flex-col divide-y divide-border">
            {branches.map((b, i) => {
              const prefix = b.invoicePrefix || b.autoPrefix;
              return (
                <div key={b.branchId} className="grid gap-3 py-3 sm:grid-cols-[8rem_1fr_1fr_8rem]">
                  <div className="text-sm">
                    <p className="font-medium">{b.name}</p>
                    {b.status === 'archived' && <p className="text-xs text-muted">Archived</p>}
                  </div>
                  <Input
                    label="GSTIN"
                    value={b.gstin}
                    onChange={(e) => {
                      const gstin = e.target.value.toUpperCase().replace(/\s/g, '');
                      setBranch(i, { gstin, ...(gstin.length >= 2 && GST_STATES.some((s) => s.value === gstin.slice(0, 2)) ? { stateCode: gstin.slice(0, 2) } : {}) });
                    }}
                    error={branchErrors[i].gstin || (values.gstRegistered && !b.gstin && b.status !== 'archived' ? 'Needed before GST bills can be issued here' : null)}
                    maxLength={15}
                  />
                  <Select label="State" placeholder="Choose a state" options={GST_STATES} value={b.stateCode} onChange={(e) => setBranch(i, { stateCode: e.target.value })} />
                  <Input
                    label="Bill prefix"
                    placeholder={b.autoPrefix}
                    value={b.invoicePrefix}
                    onChange={(e) => setBranch(i, { invoicePrefix: e.target.value.toUpperCase() })}
                    error={branchErrors[i].prefix}
                    hint={`${prefix}/${fy}/00001`}
                    maxLength={4}
                  />
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-xs text-muted">Bill numbers start again from 00001 every financial year (1 April). Bills made before now keep their old numbers.</p>
        </Card>
      </fieldset>
    </form>
  );
}
