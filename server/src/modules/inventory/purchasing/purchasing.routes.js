import { Router } from 'express';
import { z } from 'zod';
import { validate } from '../../../middleware/validate.js';
import { requireIdempotencyKey } from '../../../middleware/idempotency.js';
import { objectId, paise } from '../../../utils/schemas.js';
import * as service from './purchasing.service.js';

// /api/inventory/purchasing — purchase orders, deliveries, returns and reorder suggestions
const router = Router();
const once = requireIdempotencyKey;

const qty = z.number().int('Use a whole number').min(1, 'At least 1');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const note = z.string().trim().max(300).optional();
const orderLine = z.object({ skuId: objectId, qty, unitCost: paise.nullable().optional() });

const createOrderSchema = z.object({ supplierId: objectId, lines: z.array(orderLine).min(1, 'Add at least one product').max(100), expectedDate: date.nullable().optional(), note });
const updateOrderSchema = z.object({ version: z.number().int().min(1), supplierId: objectId.optional(), lines: z.array(orderLine).max(100).optional(), expectedDate: date.nullable().optional(), note });
const receiveSchema = z.object({
  invoiceNumber: z.string().trim().max(60).optional(),
  locationId: objectId.optional(),
  overReceiptReason: z.string().trim().max(300).optional(),
  lines: z.array(z.object({ lineId: objectId, qty: z.number().int().min(0), unitCost: paise.nullable().optional(), batch: z.string().trim().max(60).optional(), expiryDate: date.optional() })).min(1),
});
const directSchema = z.object({
  supplierId: objectId.optional(),
  invoiceNumber: z.string().trim().max(60).optional(),
  locationId: objectId.optional(),
  lines: z.array(orderLine.extend({ batch: z.string().trim().max(60).optional(), expiryDate: date.optional() })).min(1).max(100),
});
const returnSchema = z.object({
  supplierId: objectId,
  poId: objectId.optional(),
  locationId: objectId.optional(),
  reason: z.string().trim().min(3, 'Say why it is going back').max(300),
  lines: z.array(z.object({ skuId: objectId, qty })).min(1).max(100),
});

router.get('/orders', validate({ query: z.object({ status: z.string().optional() }) }), async (req, res) => {
  res.json({ orders: await service.listOrders(req.ctx, req.valid.query) });
});
router.get('/orders/:id', async (req, res) => {
  res.json(await service.getOrder(req.ctx, req.params.id));
});
router.post('/orders', once, validate({ body: createOrderSchema }), async (req, res) => {
  res.status(201).json(await service.createOrder(req.ctx, req.valid.body, req.idempotencyKey));
});
router.patch('/orders/:id', once, validate({ body: updateOrderSchema }), async (req, res) => {
  res.json(await service.updateOrder(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.post('/orders/:id/submit', once, async (req, res) => {
  res.json(await service.submitOrder(req.ctx, req.params.id, req.idempotencyKey));
});
router.post('/orders/:id/decide', once, validate({ body: z.object({ approve: z.boolean(), note }) }), async (req, res) => {
  res.json(await service.decideOrder(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
for (const step of ['order', 'cancel', 'close']) {
  router.post(`/orders/:id/${step}`, once, validate({ body: z.object({ note }) }), async (req, res) => {
    res.json(await service.moveOrder(req.ctx, req.params.id, step, req.valid.body, req.idempotencyKey));
  });
}
router.post('/orders/:id/receive', once, validate({ body: receiveSchema }), async (req, res) => {
  res.json(await service.receiveOrder(req.ctx, req.params.id, req.valid.body, req.idempotencyKey));
});
router.get('/receipts', async (req, res) => {
  res.json({ receipts: await service.listReceipts(req.ctx) });
});
router.post('/receipts', once, validate({ body: directSchema }), async (req, res) => {
  res.status(201).json(await service.directReceipt(req.ctx, req.valid.body, req.idempotencyKey));
});
router.post('/returns', once, validate({ body: returnSchema }), async (req, res) => {
  res.status(201).json(await service.returnToSupplier(req.ctx, req.valid.body, req.idempotencyKey));
});
router.get('/suggestions', async (req, res) => {
  res.json({ suggestions: await service.suggestions(req.ctx) });
});
router.post('/suggestions/orders', once, validate({ body: z.object({ lines: z.array(z.object({ skuId: objectId, qty })).min(1).max(200) }) }), async (req, res) => {
  res.status(201).json(await service.createFromSuggestions(req.ctx, req.valid.body, req.idempotencyKey));
});

export default router;
