import { Navigate, useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useMutation } from '@tanstack/react-query';
import { z } from 'zod';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { ROLE_HOME } from '../../lib/constants';
import { Button, Card, Input } from '../../components/ui';

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
    formState: { errors },
  } = useForm({ resolver: zodResolver(loginSchema) });

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
      </Card>
    </div>
  );
}
