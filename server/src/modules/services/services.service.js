import { Service } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { assertAllowedBranches } from '../branches/branches.service.js';

async function findService(ctx, id) {
  const service = await Service.findOne(scoped(ctx, { _id: id }));
  if (!service) throw new AppError(404, 'NOT_FOUND', 'Service not found');
  return service;
}

export function listServices(ctx) {
  return Service.find(scoped(ctx)).sort({ status: 1, category: 1, name: 1 }).lean();
}

export function createService(ctx, input) {
  if (input.branchIds) assertAllowedBranches(ctx, input.branchIds);
  return Service.create({ ...input, orgId: ctx.orgId });
}

// Editing a service never changes old appointments: they keep their own copy (snapshot) of name and price
export async function updateService(ctx, id, input) {
  const service = await findService(ctx, id);
  if (input.branchIds) assertAllowedBranches(ctx, input.branchIds);
  service.set(input);
  return service.save();
}

// A disabled service can't be booked any more, but still shows on old appointments
export async function setServiceStatus(ctx, id, status) {
  const service = await findService(ctx, id);
  service.status = status;
  return service.save();
}
