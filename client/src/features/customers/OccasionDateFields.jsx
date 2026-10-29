import { dayOptions, MONTH_OPTIONS } from '../../lib/occasions';
import { Select } from '../../components/ui';

// Month list plus "Select day (optional)". The day is greyed out until a month is picked, and only offers
// days that exist in that month (29 Feb is allowed). Never asks for the year.
// value: { month: '11', day: '' }; onChange gets the new value.
export default function OccasionDateFields({ label, value, onChange, disabled }) {
  const month = Number(value.month) || null;

  function setMonth(e) {
    const next = e.target.value;
    const days = dayOptions(Number(next));
    // A day that doesn't exist in the new month (31 → November) is cleared
    onChange({ month: next, day: days.some((d) => d.value === value.day) ? value.day : '' });
  }

  return (
    <fieldset className="flex flex-col gap-1" disabled={disabled}>
      <legend className="mb-1 text-sm font-medium text-ink">{label}</legend>
      <div className="grid grid-cols-2 gap-2">
        <Select aria-label={`${label}: month`} placeholder="Month" options={MONTH_OPTIONS} value={value.month} onChange={setMonth} />
        <Select
          aria-label={`${label}: day`}
          placeholder="Select day (optional)"
          options={dayOptions(month)}
          value={value.day}
          disabled={!month}
          onChange={(e) => onChange({ ...value, day: e.target.value })}
        />
      </div>
    </fieldset>
  );
}
