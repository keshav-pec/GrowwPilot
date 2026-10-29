import { Lock } from 'lucide-react';
import { describeOffer, fromRulesForm } from '../../../lib/occasions';
import { Input } from '../../../components/ui';

// The terms of one campaign: name, % or ₹ off, max ₹ (for %), minimum eligible spend, and the services that count.
// Controlled: form = { name, discountType, value, maxDiscount, minSubtotal, serviceIds } as text; errors from rulesFormErrors.
// Shared by the quick setup and the edit popup.
export default function CampaignForm({ form, onChange, errors = {}, services, disabled }) {
  const set = (field) => (e) => onChange({ ...form, [field]: e.target.value });
  const percent = form.discountType === 'PERCENT';
  const toggleService = (id) => onChange({ ...form, serviceIds: form.serviceIds.includes(id) ? form.serviceIds.filter((s) => s !== id) : [...form.serviceIds, id] });
  const ready = Object.keys(errors).length === 0;

  return (
    <fieldset disabled={disabled} className="flex flex-col gap-4">
      <Input label="Campaign name" value={form.name} onChange={set('name')} error={errors.name} maxLength={80} />

      <div className="flex flex-col gap-1">
        <span className="text-sm font-medium text-ink">Offer</span>
        <div className="flex gap-4 text-sm">
          {[
            ['PERCENT', '% off'],
            ['FLAT', '₹ off'],
          ].map(([value, label]) => (
            <label key={value} className="flex items-center gap-2">
              <input type="radio" className="accent-gold" checked={form.discountType === value} onChange={() => onChange({ ...form, discountType: value })} />
              {label}
            </label>
          ))}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <Input label={percent ? 'Percentage off' : 'Amount off (₹)'} inputMode="decimal" value={form.value} onChange={set('value')} error={errors.value} placeholder={percent ? 'e.g. 15' : 'e.g. 300'} />
        {percent && <Input label="Maximum discount (₹)" inputMode="decimal" value={form.maxDiscount} onChange={set('maxDiscount')} error={errors.maxDiscount} placeholder="e.g. 500" />}
        <Input label="Minimum eligible spend (₹)" inputMode="decimal" value={form.minSubtotal} onChange={set('minSubtotal')} error={errors.minSubtotal} hint="Before GST. 0 = no minimum." />
      </div>

      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-sm font-medium text-ink">
            Services that count ({form.serviceIds.filter((id) => services.some((s) => s._id === id)).length} of {services.length})
          </span>
          <span className="flex gap-3 text-xs">
            <button type="button" className="text-brown underline" onClick={() => onChange({ ...form, serviceIds: services.map((s) => s._id) })}>
              Select all
            </button>
            <button type="button" className="text-brown underline" onClick={() => onChange({ ...form, serviceIds: [] })}>
              Clear
            </button>
          </span>
        </div>
        <div className="grid max-h-48 gap-1 overflow-y-auto rounded-lg border border-border p-3 sm:grid-cols-2">
          {services.map((s) => (
            <label key={s._id} className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="accent-gold" checked={form.serviceIds.includes(s._id)} onChange={() => toggleService(s._id)} />
              {s.name}
            </label>
          ))}
        </div>
        {errors.serviceIds && <p className="text-xs text-danger">{errors.serviceIds}</p>}
      </div>

      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface p-3 text-xs text-muted">
        <Lock size={12} /> Active period: entire occasion month · Repeats every year · Once per occasion per customer per year
      </p>
      {ready && form.value && <p className="text-sm">The customer gets: <strong>{describeOffer(fromRulesForm(form))}</strong> on the chosen services.</p>}
    </fieldset>
  );
}
