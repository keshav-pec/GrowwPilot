// Shared wrapper for form fields: label on top, error or hint below.
export default function Field({ label, error, hint, id, children }) {
  return (
    <div className="flex flex-col gap-1">
      {label && (
        <label htmlFor={id} className="text-sm font-medium text-ink">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p className="text-xs text-danger">{error}</p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}

// Same look for Input, Select and Textarea. A red border when there is an error.
export function fieldClass(error) {
  return `w-full rounded-lg border bg-bg px-3 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30 ${
    error ? 'border-danger' : 'border-border'
  }`;
}
