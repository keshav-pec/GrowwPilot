import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { hasAddon, ROLE_HOME } from '../lib/constants';

// Not logged in -> login page. Wrong role, or an add-on the salon doesn't have -> that role's own home page.
// This only hides screens; the server is what really protects the data.
export default function ProtectedRoute({ roles, addon }) {
  const { user } = useAuth();

  if (!user) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user.role)) return <Navigate to={ROLE_HOME[user.role]} replace />;
  if (addon && !hasAddon(user, addon)) return <Navigate to={ROLE_HOME[user.role]} replace />;

  return <Outlet />;
}
