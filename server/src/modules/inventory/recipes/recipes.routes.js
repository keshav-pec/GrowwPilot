import { Router } from 'express';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { endRecipeSchema, historySchema, saveRecipeSchema } from './recipes.schemas.js';
import * as service from './recipes.service.js';

// /api/inventory/recipes — what each service uses
const router = Router();

router.get('/', async (req, res) => {
  res.json({ services: await service.listRecipes(req.ctx) });
});
router.get('/history', validate({ query: historySchema }), async (req, res) => {
  res.json({ versions: await service.recipeHistory(req.ctx, req.valid.query) });
});
router.post('/', requireIdempotencyKey, validate({ body: saveRecipeSchema }), async (req, res) => {
  res.status(201).json(await service.saveRecipe(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/end', requireIdempotencyKey, validate({ body: endRecipeSchema }), async (req, res) => {
  res.json(await service.endRecipe(req.ctx, req.valid.body, req.idempotencyKey));
});

export default router;
