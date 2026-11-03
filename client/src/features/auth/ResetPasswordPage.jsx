import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CircleCheck, Sparkles } from 'lucide-react';
import { useAuthOptions, useCheckPasswordLink, useResetPassword } from '../../api/passwords';
import { Button, Card, Input, Spinner } from '../../components/ui';

const RULE = 'At least 8 characters, with a letter and a number';
const ruleOk = (p) => p.length >= 8 && p.length <= 72 && /[A-Za-z]/.test(p) && /\d/.test(p);

// The link from a password email: /reset-password?token=... Choose a password twice, then log in.
export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const linkQuery = useCheckPasswordLink(token);
  const options = useAuthOptions();
  const reset = useResetPassword();
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [errors, setErrors] = useState({});
  const rule = options.data?.passwordRule ?? RULE;

  function submit(e) {
    e.preventDefault();
    const next = { password: ruleOk(password) ? null : rule, again: password === again ? null : 'The two passwords don’t match' };
    setErrors(next);
    if (next.password || next.again) return;
    reset.mutate({ token, password });
  }

  let content;
  if (!token || linkQuery.isError) {
    content = (
      <div className="flex flex-col gap-3 text-center text-sm">
        <p className="font-medium">This link has expired or was already used</p>
        <p className="text-muted">Links work once. A reset link lasts 1 hour; a link from your salon owner lasts 48 hours.</p>
        <Link to="/forgot-password" className="font-medium text-brown underline">
          Get a new link
        </Link>
      </div>
    );
  } else if (linkQuery.isPending) {
    content = <Spinner />;
  } else if (reset.isSuccess) {
    content = (
      <div className="flex flex-col items-center gap-3 text-center text-sm">
        <CircleCheck size={32} className="text-good" />
        <p className="font-medium">Password changed</p>
        <p className="text-muted">Please log in with your new password. You’ve been logged out on your other devices.</p>
        <Link to="/login" className="rounded-lg bg-gold px-4 py-2 font-medium text-ink hover:bg-gold-dark">
          Log in
        </Link>
      </div>
    );
  } else {
    const first = linkQuery.data.purpose === 'INVITE';
    content = (
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <p className="text-sm text-muted">
          Hi {linkQuery.data.name}, {first ? 'choose the password you’ll log in with.' : 'choose a new password.'}
        </p>
        <Input id="new-password" label="New password" type="password" autoComplete="new-password" autoFocus hint={rule} value={password} onChange={(e) => setPassword(e.target.value)} error={errors.password} />
        <Input id="new-password-again" label="New password again" type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} error={errors.again} />
        {reset.isError && <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{reset.error.message}</p>}
        <Button type="submit" loading={reset.isPending}>
          {first ? 'Set password' : 'Change password'}
        </Button>
      </form>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Sparkles size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-brown">{linkQuery.data?.purpose === 'INVITE' ? 'Set your password' : 'Choose a new password'}</h1>
        </div>
        {content}
      </Card>
    </div>
  );
}
