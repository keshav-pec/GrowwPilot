import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { AppError } from '../../utils/AppError.js';

// A link to send a bill to the customer (WhatsApp, SMS): a signed token that opens only that bill's PDF,
// with no login, for SHARE_DAYS. It can't be guessed or changed to open another bill.
export const SHARE_DAYS = 30;
const AUDIENCE = 'bill-share';

export function makeShareToken(invoice) {
  return jwt.sign({ invoiceId: String(invoice._id), orgId: String(invoice.orgId) }, env.JWT_SECRET, { audience: AUDIENCE, expiresIn: `${SHARE_DAYS}d` });
}

// -> { invoiceId, orgId }, or "not found" for a wrong or expired link
export function readShareToken(token) {
  try {
    return jwt.verify(token, env.JWT_SECRET, { audience: AUDIENCE });
  } catch {
    throw new AppError(404, 'NOT_FOUND', 'This bill link is not valid or has expired. Ask the salon for a new one.');
  }
}
