import { Customer } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { escapeRegex } from '../../utils/regex.js';

// Search this salon's customers by name or phone (used by the booking form)
export function searchCustomers(ctx, { search }) {
  const filter = scoped(ctx);
  if (search) {
    const digits = search.replace(/\D/g, '');
    filter.$or = [{ name: new RegExp(escapeRegex(search), 'i') }];
    if (digits.length >= 3) filter.$or.push({ phone: { $regex: digits } });
  }
  return Customer.find(filter).sort({ name: 1 }).limit(20).lean();
}

// One phone number = one customer per salon. If the phone already exists we don't create a
// duplicate; we return 409 with the existing customer so the screen can use them instead.
export async function createCustomer(ctx, input) {
  const existing = await Customer.findOne(scoped(ctx, { phone: input.phone })).lean();
  if (existing) {
    throw new AppError(409, 'CUSTOMER_EXISTS', `Existing customer found: ${existing.name}`, { customer: existing });
  }
  return Customer.create({ ...input, orgId: ctx.orgId });
}
