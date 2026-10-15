import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireAddon } from '../../middleware/requireAddon.js';
import { capabilities, inventoryRole } from './permissions.js';
import { getBranchSettings } from './settings/settings.service.js';

const router = Router();

// Owners, inventory logins and the front desk, only when the salon has the Inventory add-on.
// What each of them may do is checked per action with permissions.js.
router.use(requireAuth, tenantContext, requireRole('OWNER', 'FRONT_DESK', 'INVENTORY'), requireAddon('inventory'));

// GET /api/inventory/access — what I may do at the selected branch (the screens use it to show buttons)
router.get('/access', async (req, res) => {
  const branchId = req.ctx.activeBranchId;
  const settings = await getBranchSettings(req.ctx, branchId);
  res.json({ branchId, role: inventoryRole(req.ctx), can: capabilities(req.ctx, settings) });
});

export default router;
