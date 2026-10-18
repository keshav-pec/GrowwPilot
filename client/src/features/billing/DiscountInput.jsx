import { isValidRupees, toPaise } from '../../lib/money';
import { Input } from '../../components/ui';

// What the person typed -> { value: { type, value } } for the server, or { error } if it isn't a valid number.
// value is paise for ₹ and 0-100 (up to 2 decimals) for %.
export function parseDiscount({ type, text }) {
  const t = text.trim();
  if (!t) return { value: { type, value: 0 } };
  if (type === 'percent') {
    const n = Number(t);
    return /^\d+(\.\d{1,2})?$/.test(t) && n <= 100 ? { value: { type, value: n } } : { error: '0 to 100%' };
  }
  return isValidRupees(t) ? { value: { type, value: toPaise(t) } } : { error: 'Enter an amount' };
}

// A saved discount -> what goes in the box: { type: 'flat', value: 5000 } -> { type: 'flat', text: '50' }
export function discountText(type, value) {
  if (!value) return { type: type ?? 'flat', text: '' };
  return { type, text: type === 'flat' ? String(value / 100) : String(value) };
}

// "[₹ | %] [ 10 ]" — a flat or percentage discount
export default function DiscountInput({ value, onChange, error, label = 'Discount', disabled = false }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex shrink-0 rounded-lg border border-border p-0.5 text-sm">
        {['flat', 'percent'].map((type) => (
          <button
            key={type}
            type="button"
            disabled={disabled}
            onClick={() => onChange({ ...value, type })}
            className={`rounded-md px-2.5 py-1 ${value.type === type ? 'bg-gold font-medium text-ink' : 'text-muted'}`}
            aria-label={type === 'flat' ? `${label} in rupees` : `${label} in percent`}
          >
            {type === 'flat' ? '₹' : '%'}
          </button>
        ))}
      </div>
      <div className="w-24">
        <Input inputMode="decimal" placeholder="0" value={value.text} onChange={(e) => onChange({ ...value, text: e.target.value })} error={error} aria-label={label} disabled={disabled} />
      </div>
    </div>
  );
}
