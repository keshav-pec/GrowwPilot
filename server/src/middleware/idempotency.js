import mongoose from 'mongoose';
import { IdempotencyRecord } from '../models/index.js';
import { AppError } from '../utils/AppError.js';

// Changes that must never happen twice (stock movements, new products...) need an Idempotency-Key header:
// a random id the screen makes once per form. Sending the same request again (double click, network retry)
// gives back the first answer instead of doing the change again.

// Route step: refuses the request without a key, and puts it on req.idempotencyKey
export function requireIdempotencyKey(req, res, next) {
  const key = req.get('Idempotency-Key');
  if (!key || key.length < 8 || key.length > 100) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Missing Idempotency-Key header');
  }
  req.idempotencyKey = key;
  next();
}

function replay(record, operation) {
  if (record.operation !== operation) {
    throw new AppError(409, 'IDEMPOTENCY_KEY_REUSED', 'This request key was already used for something else');
  }
  return record.result;
}

// Runs `work(session)` in a transaction, once per salon and key. The result is saved in the same transaction,
// so either the change and its saved result are both there, or neither is.
//   return runOnce(ctx, { key, operation: 'inventory.sku.create' }, async (session) => { ...; return result; });
export async function runOnce(ctx, { key, operation }, work) {
  const earlier = await IdempotencyRecord.findOne({ orgId: ctx.orgId, key }).lean();
  if (earlier) return replay(earlier, operation);

  try {
    return await mongoose.connection.transaction(async (session) => {
      const result = await work(session);
      // Saved as plain JSON, exactly what the first caller receives
      const saved = result === undefined ? null : JSON.parse(JSON.stringify(result));
      await IdempotencyRecord.create([{ orgId: ctx.orgId, key, operation, result: saved }], { session });
      return saved;
    });
  } catch (err) {
    // The same key at the same moment: the other request won (so this one hit its saved result, or found the
    // change already made), so give back the winner's answer
    const winner = await IdempotencyRecord.findOne({ orgId: ctx.orgId, key }).lean();
    if (winner) return replay(winner, operation);
    throw err;
  }
}
