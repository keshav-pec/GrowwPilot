import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3 p-4 text-center">
      <h1 className="text-4xl font-bold text-brown">404</h1>
      <p className="text-muted">This page does not exist.</p>
      <Link to="/" className="text-sm font-medium text-gold-dark underline">
        Go home
      </Link>
    </div>
  );
}
