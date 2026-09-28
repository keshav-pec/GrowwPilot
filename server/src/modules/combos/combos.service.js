import { Combo, Service } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { assertAllowedBranches } from '../branches/branches.service.js';

// Every service in a combo must be an active service of THIS salon
async function assertServicesUsable(ctx, serviceIds) {
  const count = await Service.countDocuments(scoped(ctx, { _id: { $in: serviceIds }, status: 'active' }));
  if (count !== serviceIds.length) {
    throw new AppError(400, 'INVALID_SERVICE', 'One or more services are not available');
  }
}

async function findCombo(ctx, id) {
  const combo = await Combo.findOne(scoped(ctx, { _id: id }));
  if (!combo) throw new AppError(404, 'NOT_FOUND', 'Combo not found');
  return combo;
}

const SERVICE_FIELDS = 'name price durationMinutes status';

export function listCombos(ctx) {
  return Combo.find(scoped(ctx)).populate('serviceIds', SERVICE_FIELDS).sort({ status: 1, name: 1 }).lean();
}

export async function createCombo(ctx, input) {
  await assertServicesUsable(ctx, input.serviceIds);
  if (input.branchIds) assertAllowedBranches(ctx, input.branchIds);
  const combo = await Combo.create({ ...input, orgId: ctx.orgId });
  return combo.populate('serviceIds', SERVICE_FIELDS);
}

export async function updateCombo(ctx, id, input) {
  const combo = await findCombo(ctx, id);
  if (input.serviceIds) await assertServicesUsable(ctx, input.serviceIds);
  if (input.branchIds) assertAllowedBranches(ctx, input.branchIds);
  combo.set(input);
  await combo.save();
  return combo.populate('serviceIds', SERVICE_FIELDS);
}

export async function setComboStatus(ctx, id, status) {
  const combo = await findCombo(ctx, id);
  combo.status = status;
  await combo.save();
  return combo.populate('serviceIds', SERVICE_FIELDS);
}
