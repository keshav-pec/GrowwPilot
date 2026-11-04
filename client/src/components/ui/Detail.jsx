// A small label with its value under it (profile and salon details). Goes inside a <dl>.
export default function Detail({ label, children }) {
  return (
    <div>
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-sm">{children || '—'}</dd>
    </div>
  );
}
