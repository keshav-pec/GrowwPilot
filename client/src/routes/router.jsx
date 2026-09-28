import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../lib/constants';
import ProtectedRoute from './ProtectedRoute';
import AdminLayout from '../layouts/AdminLayout';
import AppLayout from '../layouts/AppLayout';
import LoginPage from '../features/auth/LoginPage';
import NotFoundPage from './NotFoundPage';
import Placeholder from '../components/Placeholder';

// "/" sends you to your home page, or to login if you are not logged in
function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}

// The screen map (plan, Phase 2). Each Placeholder is replaced by a real page in its phase.
export const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  { path: '/login', element: <LoginPage /> },

  // Super Admin area
  {
    element: <ProtectedRoute roles={['SUPER_ADMIN']} />,
    children: [
      {
        path: '/admin',
        element: <AdminLayout />,
        children: [
          { index: true, element: <Navigate to="salons" replace /> },
          { path: 'salons', element: <Placeholder title="Salons" subtitle="Search and manage onboarded salons" phase={5} /> },
          { path: 'salons/new', element: <Placeholder title="Onboard a salon" phase={5} /> },
          { path: 'salons/:id', element: <Placeholder title="Salon details" phase={5} /> },
        ],
      },
    ],
  },

  // Salon area (owner and front desk)
  {
    element: <ProtectedRoute roles={['OWNER', 'FRONT_DESK']} />,
    children: [
      {
        path: '/app',
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },

          // Owner and front desk
          { path: 'today', element: <Placeholder title="Day board" subtitle="Who is free right now" phase={8} /> },
          { path: 'appointments', element: <Placeholder title="Appointments" phase={8} /> },
          { path: 'appointments/new', element: <Placeholder title="New appointment" phase={8} /> },
          { path: 'customers', element: <Placeholder title="Customers" phase={9} /> },
          { path: 'customers/:id', element: <Placeholder title="Customer profile" phase={9} /> },
          { path: 'leads', element: <Placeholder title="Leads" phase={10} /> },
          { path: 'checkout/:appointmentId', element: <Placeholder title="Checkout" phase={11} /> },
          { path: 'attendance', element: <Placeholder title="Staff attendance" phase={12} /> },

          // Owner only
          {
            element: <ProtectedRoute roles={['OWNER']} />,
            children: [
              { path: 'dashboard', element: <Placeholder title="Dashboard" subtitle="How is the salon doing today?" phase={13} /> },
              { path: 'analytics', element: <Placeholder title="Analytics" phase={14} /> },
              { path: 'branches', element: <Placeholder title="Branches" phase={6} /> },
              { path: 'team', element: <Placeholder title="Team" phase={6} /> },
              { path: 'catalog', element: <Placeholder title="Services & combos" phase={6} /> },
              { path: 'settings/salary', element: <Placeholder title="Salary" message="Staff salary: coming soon." /> },
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
]);
