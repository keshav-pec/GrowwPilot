import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { tenantContext } from '../../middleware/tenantContext.js';
import { requireRole } from '../../middleware/requireRole.js';
import { requireAddon } from '../../middleware/requireAddon.js';
import { capabilities, inventoryRole } from './permissions.js';
import { getBranchSettings } from './settings/settings.service.js';
import skuRoutes from './skus/skus.routes.js';
import locationRoutes from './locations/locations.routes.js';
import importRoutes from './imports/imports.routes.js';
import setupRoutes from './setup/setup.routes.js';
import allocationRoutes from './allocations/allocations.routes.js';
import movementRoutes from './movements/movements.routes.js';
import requestRoutes from './approvals/approvals.routes.js';
import recipeRoutes from './recipes/recipes.routes.js';
import automationRoutes from './automation/automation.routes.js';
import supplierRoutes from './suppliers/suppliers.routes.js';
import purchasingRoutes from './purchasing/purchasing.routes.js';
import stockCountRoutes from './stockCounts/stockCounts.routes.js';
import settingsRoutes from './settings/settings.routes.js';
import reportRoutes from './reports/reports.routes.js';
import imageRoutes from './images/images.routes.js';
import { getOverview } from './overview/overview.service.js';

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

router.use('/skus', imageRoutes); // photos: /skus/:id/images...
router.use('/skus', skuRoutes);
router.use('/locations', locationRoutes);
router.use('/imports', importRoutes);
router.use('/setup', setupRoutes);
router.use('/allocations', allocationRoutes);
router.use('/movements', movementRoutes);
router.use('/requests', requestRoutes);
router.use('/recipes', recipeRoutes);
router.use('/automation', automationRoutes);
router.use('/suppliers', supplierRoutes);
router.use('/purchasing', purchasingRoutes);
router.use('/stock-counts', stockCountRoutes);
router.use('/settings', settingsRoutes);
router.use('/reports', reportRoutes);

// GET /api/inventory/overview — the Overview tab for the selected branch
router.get('/overview', async (req, res) => {
  res.json(await getOverview(req.ctx));
});

export default router;
