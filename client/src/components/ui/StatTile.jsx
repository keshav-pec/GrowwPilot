// A small box with a label and a big number. The look can be changed with the class props.
export default function StatTile({ label, value, hint, tone = 'text-brown', labelClass = 'text-xs', valueClass = 'text-2xl font-bold', className = 'rounded-xl border border-border p-4' }) {
  return (
    <div className={className}>
      <p className={`${labelClass} text-muted`}>{label}</p>
      <p className={`${valueClass} ${tone}`}>{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );
}

// The look used for the headline numbers on the Dashboard, Analytics and Monthly payroll
export const HEADLINE_TILE = { labelClass: 'text-sm', valueClass: 'mt-1 text-2xl font-semibold', tone: 'text-ink', className: 'rounded-xl border border-border bg-bg p-4' };
