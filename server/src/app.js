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

const app = express();

// In production the API sits behind a proxy (Render/Vercel). This lets Express see the
// real visitor IP, which the login rate limiter needs.
app.set('trust proxy', 1);

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

// --- Errors (must come after all routes) ---
app.use(notFound);
app.use(errorHandler);

export default app;
