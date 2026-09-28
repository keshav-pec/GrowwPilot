const tones = {
  neutral: 'bg-surface text-muted border-border',
  gold: 'bg-gold/15 text-gold-dark border-gold/40',
  yellow: 'bg-yellow-soft text-ink border-yellow',
  orange: 'bg-orange/10 text-orange border-orange/40',
  brown: 'bg-brown/10 text-brown border-brown/30',
  danger: 'bg-danger/10 text-danger border-danger/30',
};

export default function Badge({ tone = 'neutral', children }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${tones[tone]}`}>
      {children}
    </span>
  );
}
