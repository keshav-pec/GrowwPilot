import Spinner from './Spinner';

const variants = {
  primary: 'bg-gold text-ink hover:bg-gold-dark',
  secondary: 'bg-bg text-ink border border-border hover:bg-surface',
  ghost: 'text-ink hover:bg-surface',
  danger: 'bg-danger text-white hover:opacity-90',
};

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-4 py-2 text-sm',
};

export default function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  className = '',
  children,
  ...props
}) {
  return (
    <button
      type="button"
      disabled={loading || disabled}
      className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    >
      {loading && <Spinner size={16} className="text-current" />}
      {children}
    </button>
  );
}
