import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env.js';
import { isDBConnected } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';
import authRoutes from './modules/auth/auth.routes.js';
import branchRoutes from './modules/branches/branches.routes.js';
import adminRoutes from './modules/admin/admin.routes.js';
import staffRoutes from './modules/staff/staff.routes.js';
import userRoutes from './modules/users/users.routes.js';
import serviceRoutes from './modules/services/services.routes.js';
import comboRoutes from './modules/combos/combos.routes.js';
import availabilityRoutes from './modules/appointments/availability.routes.js';
import appointmentRoutes from './modules/appointments/appointments.routes.js';
import customerRoutes from './modules/customers/customers.routes.js';
import leadRoutes from './modules/leads/leads.routes.js';
import invoiceRoutes from './modules/invoices/invoices.routes.js';
import attendanceRoutes from './modules/attendance/attendance.routes.js';
import dashboardRoutes from './modules/dashboard/dashboard.routes.js';
import analyticsRoutes from './modules/analytics/analytics.routes.js';

const app = express();

// In production the API sits behind proxies (Vercel -> Render). Trusting that many hops lets Express
// see the real visitor IP, which the login rate limiter needs (otherwise every visitor looks like Vercel).
app.set('trust proxy', env.TRUST_PROXY);

// --- Global middleware ---
app.use(helmet()); // sets safe HTTP headers
app.use(cors({ origin: env.CLIENT_ORIGIN, credentials: true })); // only our frontend may call the API, with cookies
app.use(express.json({ limit: '100kb' })); // reads JSON request bodies
app.use(cookieParser()); // reads cookies (we'll store the login token in one)
if (env.NODE_ENV === 'development') app.use(morgan('dev')); // logs each request in the terminal

// --- Routes ---
app.get('/api/health', (req, res) => {
  res.json({ ok: true, db: isDBConnected() ? 'connected' : 'disconnected' });
});
app.use('/api/auth', authRoutes);
app.use('/api/branches', branchRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/staff', staffRoutes);
app.use('/api/users', userRoutes);
app.use('/api/services', serviceRoutes);
app.use('/api/combos', comboRoutes);
app.use('/api/availability', availabilityRoutes);
app.use('/api/appointments', appointmentRoutes);
app.use('/api/customers', customerRoutes);
app.use('/api/leads', leadRoutes);
app.use('/api/invoices', invoiceRoutes);
app.use('/api/attendance', attendanceRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/analytics', analyticsRoutes);

// --- Errors (must come after all routes) ---
app.use(notFound);
app.use(errorHandler);

export default app;
