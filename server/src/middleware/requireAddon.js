import { AppError } from '../utils/AppError.js';
import { enabledAddons } from '../config/addons.js';

// Only lets the request through when the salon has this add-on switched on.
// Usage: router.use(requireAuth, tenantContext, requireAddon('inventory'))
export function requireAddon(name) {
  return (req, res, next) => {
    if (!enabledAddons(req.org).includes(name)) {
      throw new AppError(403, 'ADDON_DISABLED', 'This feature is not switched on for your salon');
    }
    next();
  };
}
