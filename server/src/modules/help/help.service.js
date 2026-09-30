import { Branch, Organization } from '../../models/index.js';
import { scoped } from '../../utils/scoped.js';
import { answerQuestion, welcome } from './help.matcher.js';

// Who is asking, taken from the logged-in session (never from the request),
// so a front desk user can't pretend to be an owner to get owner-only answers.
async function whoIsAsking(ctx, user) {
  const [branch, org] = await Promise.all([
    Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).select('name').lean(),
    Organization.findById(ctx.orgId).select('name').lean(),
  ]);
  return {
    audience: user.role === 'FRONT_DESK' ? 'FRONT_DESK' : ctx.isPrimaryOwner ? 'PRIMARY_OWNER' : 'BRANCH_OWNER',
    name: user.name.split(' ')[0], // "Kavya (Andheri desk)" -> "Kavya"
    branch: branch?.name ?? 'your branch',
    salon: org?.name ?? 'your salon',
  };
}

export async function ask(ctx, user, message) {
  return answerQuestion(message, await whoIsAsking(ctx, user));
}

export async function start(ctx, user) {
  return welcome(await whoIsAsking(ctx, user));
}
