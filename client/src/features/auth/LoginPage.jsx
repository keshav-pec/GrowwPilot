import { Navigate, useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { useAuth } from '../../auth/AuthContext';
import { useHealth } from '../../api/health';
import { ROLE_HOME, ROLE_LABEL } from '../../lib/constants';
import { Badge, Button, Card } from '../../components/ui';

// TEMPORARY (Phase 2): pick a role to preview its screens.
// Phase 4 replaces the buttons with a real email + password form.
export default function LoginPage() {
  const { user, loginAs } = useAuth();
  const navigate = useNavigate();
  const health = useHealth();

  if (user) return <Navigate to={ROLE_HOME[user.role]} replace />;

  function handlePick(role) {
    loginAs(role);
    navigate(ROLE_HOME[role]);
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-2 text-center">
          <Sparkles size={28} className="text-gold" />
          <h1 className="text-2xl font-bold text-brown">GrowwPilot</h1>
          <p className="text-sm text-muted">Preview mode: choose a role to explore.</p>
        </div>

        <div className="flex flex-col gap-2">
          {['SUPER_ADMIN', 'OWNER', 'FRONT_DESK'].map((role) => (
            <Button key={role} variant={role === 'OWNER' ? 'primary' : 'secondary'} onClick={() => handlePick(role)}>
              Continue as {ROLE_LABEL[role]}
            </Button>
          ))}
        </div>

        {/* Shows that the frontend can reach the backend and database */}
        {/* <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted">
          API:
          {health.isPending && <Badge>checking…</Badge>}
          {health.isError && <Badge tone="danger">{health.error.message}</Badge>}
          {health.data && (
            <Badge tone={health.data.db === 'connected' ? 'brown' : 'orange'}>database {health.data.db}</Badge>
          )}
        </div> */}
      </Card>
    </div>
  );
}
