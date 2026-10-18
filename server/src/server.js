import app from './app.js';
import { env } from './config/env.js';
import { connectDB } from './config/db.js';
import { startInventoryAutomation } from './modules/inventory/automation/outbox.js';
import { migrateBilling } from './scripts/migrate-billing-v2.js';

// Connect to the database first, then start accepting requests
try {
  await connectDB();
  await migrateBilling(); // older bills onto the new bill records (does nothing once they're all moved)
  app.listen(env.PORT, () => {
    console.log(`Server running on http://localhost:${env.PORT}`);
  });
  startInventoryAutomation(); // stock used by completed services, and retries
} catch (err) {
  console.error('Could not connect to MongoDB:', err.message);
  process.exit(1);
}
