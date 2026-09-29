import { createBrowserRouter, Navigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { ROLE_HOME } from '../lib/constants';
import ProtectedRoute from './ProtectedRoute';
import AdminLayout from '../layouts/AdminLayout';
import AppLayout from '../layouts/AppLayout';
import LoginPage from '../features/auth/LoginPage';
import SalonsPage from '../features/admin/SalonsPage';
import NewSalonPage from '../features/admin/NewSalonPage';
import SalonDetailPage from '../features/admin/SalonDetailPage';
import BranchesPage from '../features/branches/BranchesPage';
import TeamPage from '../features/team/TeamPage';
import CatalogPage from '../features/catalog/CatalogPage';
import DayBoardPage from '../features/appointments/DayBoardPage';
import AppointmentsPage from '../features/appointments/AppointmentsPage';
import BookingPage from '../features/appointments/BookingPage';
import CustomersPage from '../features/customers/CustomersPage';
import CustomerProfilePage from '../features/customers/CustomerProfilePage';
import LeadsPage from '../features/leads/LeadsPage';
import LeadConvertPage from '../features/leads/LeadConvertPage';
import CheckoutPage from '../features/checkout/CheckoutPage';
import InvoicePage from '../features/checkout/InvoicePage';
import AttendancePage from '../features/attendance/AttendancePage';
import DashboardPage from '../features/dashboard/DashboardPage';
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
          { path: 'salons', element: <SalonsPage /> },
          { path: 'salons/new', element: <NewSalonPage /> },
          { path: 'salons/:id', element: <SalonDetailPage /> },
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
          { path: 'today', element: <DayBoardPage /> },
          { path: 'appointments', element: <AppointmentsPage /> },
          { path: 'appointments/new', element: <BookingPage /> },
          { path: 'appointments/:id/edit', element: <BookingPage /> },
          { path: 'customers', element: <CustomersPage /> },
          { path: 'customers/:id', element: <CustomerProfilePage /> },
          { path: 'leads', element: <LeadsPage /> },
          { path: 'leads/:id/convert', element: <LeadConvertPage /> },
          { path: 'checkout/:appointmentId', element: <CheckoutPage /> },
          { path: 'invoices/:id', element: <InvoicePage /> },
          { path: 'attendance', element: <AttendancePage /> },

          // Owner only
          {
            element: <ProtectedRoute roles={['OWNER']} />,
            children: [
              { path: 'dashboard', element: <DashboardPage /> },
              { path: 'analytics', element: <Placeholder title="Analytics" phase={14} /> },
              { path: 'branches', element: <BranchesPage /> },
              { path: 'team', element: <TeamPage /> },
              { path: 'catalog', element: <CatalogPage /> },
              {
                path: 'settings/salary',
                element: (
                  <Placeholder
                    title="Salary & payouts"
                    message="You’ll be able to set fixed pay and commission per stylist, and get a monthly payout sheet built from attendance and completed services."
                  />
                ),
              },
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
]);
