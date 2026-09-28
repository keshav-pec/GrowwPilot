export default function Card({ title, actions, className = '', children }) {
  return (
    <div className={`rounded-xl border border-border bg-bg p-4 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          {title && <h3 className="font-semibold text-brown">{title}</h3>}
          {actions}
        </div>
      )}
      {children}
    </div>
  );
}
