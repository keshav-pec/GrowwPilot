// A list of checkboxes that picks several items (branches, services...).
// items: [{ _id, name }] · value: array of ids
// allLabel: if given, an extra box that means "none ticked = all", e.g. "All branches"
export default function CheckboxList({ label, items, value, onChange, allLabel, error }) {
  function toggle(id) {
    onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  }

  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-sm font-medium text-ink">{label}</legend>
      {allLabel && (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.length === 0} onChange={() => onChange([])} className="accent-gold" />
          {allLabel}
        </label>
      )}
      {items.map((item) => (
        <label key={item._id} className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value.includes(item._id)} onChange={() => toggle(item._id)} className="accent-gold" />
          {item.name}
        </label>
      ))}
      {error && <p className="text-xs text-danger">{error}</p>}
    </fieldset>
  );
}
