import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import morgan from 'morgan';
import { env } from './config/env.js';
import { isDBConnected } from './config/db.js';
import { notFound, errorHandler } from './middleware/errorHandler.js';

const app = express();

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

// --- Errors (must come after all routes) ---
app.use(notFound);
app.use(errorHandler);

export default app;
