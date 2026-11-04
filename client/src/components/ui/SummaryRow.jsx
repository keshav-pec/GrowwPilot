// A label on the left and a value on the right (bill totals). Goes inside a <dl>.
export default function SummaryRow({ label, value, muted = false }) {
  return (
    <div className={`flex justify-between ${muted ? 'text-muted' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}
