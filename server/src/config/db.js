import mongoose from 'mongoose';
import { env } from './env.js';

export async function connectDB() {
  await mongoose.connect(env.MONGODB_URI);
  console.log('MongoDB connected');
}

// Used by the health check: readyState 1 means "connected"
export function isDBConnected() {
  return mongoose.connection.readyState === 1;
}
