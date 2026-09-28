import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';

// Connect to the database first, then start accepting requests
try {
  await connectDB();
  app.listen(env.PORT, () => {
    console.log(`Server running on http://localhost:${env.PORT}`);
  });
} catch (err) {
  console.error('Could not connect to MongoDB:', err.message);
  process.exit(1);
}
