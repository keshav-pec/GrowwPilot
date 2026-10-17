import { lazy, Suspense } from 'react';
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
import PayrollPage from '../features/payroll/PayrollPage';
import InventoryPage from '../features/inventory/InventoryPage';
import CataloguePrintPage from '../features/inventory/catalogue/CataloguePrintPage';
import NotFoundPage from './NotFoundPage';
import { Spinner } from '../components/ui';

// Analytics uses a big chart library, so it's only downloaded when an owner opens that page
const AnalyticsPage = lazy(() => import('../features/analytics/AnalyticsPage'));

// "/" sends you to your home page, or to login if you are not logged in
function HomeRedirect() {
  const { user } = useAuth();
  return <Navigate to={user ? ROLE_HOME[user.role] : '/login'} replace />;
}

// The screen map (plan, Phase 2).
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

  // Salon area (owner, front desk and inventory logins)
  {
    element: <ProtectedRoute roles={['OWNER', 'FRONT_DESK', 'INVENTORY']} />,
    children: [
      {
        path: '/app',
        element: <AppLayout />,
        children: [
          { index: true, element: <HomeRedirect /> },

          // Inventory add-on: owners, front desk and inventory logins (who see only this page)
          {
            element: <ProtectedRoute roles={['OWNER', 'FRONT_DESK', 'INVENTORY']} addon="inventory" />,
            children: [
              { path: 'inventory', element: <InventoryPage /> },
              { path: 'inventory/catalogue', element: <CataloguePrintPage /> }, // printable catalogue
            ],
          },

          // Owner and front desk
          {
            element: <ProtectedRoute roles={['OWNER', 'FRONT_DESK']} />,
            children: [
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
              { path: 'payroll', element: <PayrollPage /> }, // front desk: pay setup + requests only
            ],
          },

          // Owner only
          {
            element: <ProtectedRoute roles={['OWNER']} />,
            children: [
              { path: 'dashboard', element: <DashboardPage /> },
              {
                path: 'analytics',
                element: (
                  <Suspense fallback={<Spinner size={28} />}>
                    <AnalyticsPage />
                  </Suspense>
                ),
              },
              { path: 'branches', element: <BranchesPage /> },
              { path: 'team', element: <TeamPage /> },
              { path: 'catalog', element: <CatalogPage /> },
              { path: 'settings/salary', element: <Navigate to="/app/payroll" replace /> }, // old link
            ],
          },
        ],
      },
    ],
  },

  { path: '*', element: <NotFoundPage /> },
]);
