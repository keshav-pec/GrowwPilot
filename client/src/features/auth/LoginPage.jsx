import { Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_HOME } from '../../lib/constants';
import { Button, Card, Input } from '../../components/ui';

const DEMO_PASSWORD = 'Password@123';
const DEMO_ACCOUNTS = [
  ['Super Admin', 'admin@growwpilot.com'],
  ['Owner · Glamour Studio (all branches)', 'owner@glamour.com'],
  ['Branch owner · Bandra only', 'bandra.owner@glamour.com'],
  ['Front desk · Andheri', 'desk.andheri@glamour.com'],
  ['Owner · Desert Rose (Dubai)', 'owner@desertrose.com'],
];

const loginSchema = z.object({
  email: z.email('Enter a valid email'),
  password: z.string().min(1, 'Password is required'),
});

// One login page for everyone. After login, each role goes to its own home page.
export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();

  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm({ resolver: zodResolver(loginSchema) });

  // Demo: click an account to fill in the form
  function fillDemo(email) {
    setValue('email', email, { shouldValidate: true });
    setValue('password', DEMO_PASSWORD, { shouldValidate: true });
  }

  const loginMutation = useMutation({
    mutationFn: ({ email, password }) => login(email, password),
    onSuccess: (loggedInUser) => navigate(ROLE_HOME[loggedInUser.role], { replace: true }),
  });

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Sparkles size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-brown">GrowwPilot</h1>
          <p className="text-sm text-muted">Log in to manage your salon</p>
        </div>

        <form onSubmit={handleSubmit((values) => loginMutation.mutate(values))} className="flex flex-col gap-4" noValidate>
          <Input
            label="Email"
            type="email"
            autoComplete="email"
            autoFocus
            error={errors.email?.message}
            {...register('email')}
          />
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            error={errors.password?.message}
            {...register('password')}
          />

          {loginMutation.isError && (
            <p className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{loginMutation.error.message}</p>
          )}

          <Button type="submit" loading={loginMutation.isPending}>
            Log in
          </Button>
        </form>

        {/* Demo accounts from the seed script (npm run seed). Click one to fill in the form. */}
        <details className="mt-6 rounded-lg border border-border px-3 py-2 text-sm">
          <summary className="cursor-pointer font-medium text-ink">Demo accounts</summary>
          <p className="mt-2 text-xs text-muted">Password for all: {DEMO_PASSWORD}</p>
          <ul className="mt-2 flex flex-col gap-1">
            {DEMO_ACCOUNTS.map(([label, email]) => (
              <li key={email}>
                <button type="button" onClick={() => fillDemo(email)} className="w-full rounded px-2 py-1 text-left hover:bg-surface">
                  <span className="font-medium">{label}</span>
                  <span className="block text-xs text-muted">{email}</span>
                </button>
              </li>
            ))}
          </ul>
        </details>
      </Card>
    </div>
  );
}
