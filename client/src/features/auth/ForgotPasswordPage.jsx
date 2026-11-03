import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, MailCheck, Sparkles } from 'lucide-react';
import { useForgotPassword } from '../../api/passwords';
import { Button, Card, Input } from '../../components/ui';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// "Forgot password?": the person types their login email and we email them a link (if the account exists).
// The answer is always the same, so nobody can use this page to find out which emails have an account.
export default function ForgotPasswordPage() {
  const forgot = useForgotPassword();
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  function submit(e) {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) return setError('Enter a valid email');
    setError(null);
    forgot.mutate({ email: email.trim() });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Sparkles size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-brown">Forgot password</h1>
        </div>
        {forgot.isSuccess ? (
          <div className="flex flex-col items-center gap-3 text-center text-sm">
            <MailCheck size={32} className="text-good" />
            <p className="font-medium">Check your email</p>
            <p className="text-muted">If an account exists for {email.trim()}, we’ve sent a link to choose a new password. It works once, for 1 hour. Look in your spam folder too.</p>
          </div>
        ) : (
          <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
            <p className="text-sm text-muted">Enter the email you log in with. We’ll email you a link to choose a new password.</p>
            <Input id="forgot-email" label="Email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} error={error} />
            {forgot.isError && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{forgot.error.message}</p>}
            <Button type="submit" loading={forgot.isPending}>
              Email me a link
            </Button>
          </form>
        )}
        <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-muted hover:text-ink">
          <ArrowLeft size={14} /> Back to log in
        </Link>
      </Card>
    </div>
  );
}
