// Owners: switch between the two sections of payroll, "Staff" (stylists, beauticians) and "Front desk"
export const GROUPS = [
  { value: 'staff', label: 'Staff' },
  { value: 'front-desk', label: 'Front desk' },
];

// Which section a pay row belongs to (people saved before front desk existed are staff)
export const groupOf = (kind) => (kind === 'FRONT_DESK' ? 'front-desk' : 'staff');

// counts: { staff: 4, 'front-desk': 1 } (optional)
export default function GroupSwitch({ value, onChange, counts }) {
  return (
    <div className="inline-flex rounded-lg border border-border p-0.5" role="tablist" aria-label="Section">
      {GROUPS.map((group) => (
        <button
          key={group.value}
          type="button"
          role="tab"
          aria-selected={value === group.value}
          onClick={() => onChange(group.value)}
          className={`rounded-md px-3 py-1 text-sm font-medium ${value === group.value ? 'bg-gold/15 text-ink' : 'text-muted hover:text-ink'}`}
        >
          {group.label}
          {counts && <span className="ml-1 text-xs text-muted">({counts[group.value] ?? 0})</span>}
        </button>
      ))}
    </div>
  );
}
