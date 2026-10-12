import mongoose from 'mongoose';
import { Branch, CommissionRule, PayChangeRequest, PayPlan, Service, Staff } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { todayInZone } from '../../utils/time.js';
import { findStaff } from '../staff/staff.service.js';
import { actorRole, logActivity } from '../activity/activity.service.js';
import { branchApproverIds, businessOwnerIds, notify } from '../notifications/notifications.service.js';
import { PAY_PARTS, checkNewStart, cleanPayParts, currentAndUpcoming, dayBefore, describePay, formatDay, formatPercent, planStatus } from './payPlan.rules.js';
import { monthCommission, monthTotals, syncCommissions } from './commission.service.js';
import { markPayrollStale } from './payrollStale.js';

// Who can do what (PAYROLL_PLAN.md):
// - business owner: every branch; branch owner: only their branches (findStaff checks the branch)
// - front desk: sees pay setups at their branch and can only REQUEST a change; an owner approves it
// - every change goes in the activity log, and the business owner is notified of changes made by others

const ACTIVITY_LINK = '/app/payroll?tab=activity';
const REQUESTS_LINK = '/app/payroll?tab=requests';

async function todayAt(branchId) {
  const branch = await Branch.findById(branchId).select('timezone').lean();
  return todayInZone(branch.timezone);
}

// The safe values kept in the activity log (no names or ids, just the pay)
function payValues(plan) {
  if (!plan) return null;
  const values = { model: plan.model, effectiveFrom: plan.effectiveFrom, effectiveTo: plan.effectiveTo ?? null };
  for (const part of PAY_PARTS) if (plan[part] !== null && plan[part] !== undefined) values[part] = plan[part];
  return values;
}

const startsOn = (plan) => `${describePay(plan)} from ${formatDay(plan.effectiveFrom)}`;

// Log a change and tell the business owner(s) about it (unless they made it themselves)
async function recordChange(ctx, { action, staff, summary, before, after }, session) {
  await logActivity(ctx, { action, branchId: staff.branchId, staffId: staff._id, summary, before, after }, session);
  await markPayrollStale(ctx.orgId, staff.branchId);
  await notify(ctx, await businessOwnerIds(ctx), { message: `${ctx.userName} (${actorRole(ctx)}): ${summary}`, link: ACTIVITY_LINK }, session);
}

function latestPlan(ctx, staffId, session) {
  return PayPlan.findOne(scoped(ctx, { staffId })).sort({ effectiveFrom: -1 }).session(session ?? null);
}

// A pay setup that starts today or earlier may cover bills already paid: work out their commission now.
// Commission already written is never changed (a new rate only counts from the next bill).
async function catchUpCommission(ctx, plan, staff) {
  const today = await todayAt(staff.branchId);
  if (plan.commissionBps && plan.effectiveFrom <= today) {
    await syncCommissions(ctx.orgId, { staffId: staff._id, from: plan.effectiveFrom, to: today });
  }
}

// Adds a plan to the end of the person's timeline, closing the previous one the day before
async function insertPlan(ctx, staff, input, session, extra = {}) {
  const parts = cleanPayParts(input);
  const previous = await latestPlan(ctx, staff._id, session);
  const before = payValues(previous);

  const previousEnd = checkNewStart(previous, input.effectiveFrom, staff.name);
  if (previousEnd) {
    previous.effectiveTo = previousEnd;
    previous.endReason = 'replaced';
    await previous.save({ session });
  }

  const [plan] = await PayPlan.create(
    [{ orgId: ctx.orgId, staffId: staff._id, ...parts, effectiveFrom: input.effectiveFrom, note: input.note, createdBy: ctx.userId, ...extra }],
    { session }
  );
  return { plan, previous, before };
}

// Both reads in one place: the plan, its staff member (branch access checked), and whether it's the latest
async function findEditablePlan(ctx, id) {
  const plan = await PayPlan.findOne(scoped(ctx, { _id: id }));
  if (!plan) throw new AppError(404, 'NOT_FOUND', 'Pay setup not found');
  const staff = await findStaff(ctx, plan.staffId);
  const later = await PayPlan.exists(scoped(ctx, { staffId: plan.staffId, effectiveFrom: { $gt: plan.effectiveFrom } }));
  if (later) throw new AppError(409, 'NOT_LATEST', 'Only the latest pay setup can be changed. Change or cancel the newer one first.');
  return { plan, staff, today: await todayAt(staff.branchId) };
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

// The "Pay setup" list: every stylist at the selected branch, how they're paid today, and what's coming
export async function listStaffPay(ctx) {
  const today = await todayAt(ctx.activeBranchId);
  const staff = await Staff.find(scoped(ctx, { branchId: ctx.activeBranchId, status: { $ne: 'archived' } }))
    .select('name role status')
    .sort({ status: 1, name: 1 })
    .lean();
  const staffIds = staff.map((s) => s._id);
  const [plans, pending] = await Promise.all([
    PayPlan.find(scoped(ctx, { staffId: { $in: staffIds } })).lean(),
    PayChangeRequest.find(scoped(ctx, { staffId: { $in: staffIds }, status: 'pending' })).lean(),
  ]);

  // Owners also see commission earned so far this month (the front desk only sees pay setups)
  const commission = ctx.role === 'OWNER' ? await monthTotals(ctx, staffIds, today.slice(0, 7)) : null;

  const rows = staff.map((s) => {
    const mine = plans.filter((p) => String(p.staffId) === String(s._id));
    return {
      staff: s,
      ...currentAndUpcoming(mine, today),
      pendingRequest: pending.find((r) => String(r.staffId) === String(s._id)) ?? null,
      ...(commission && { commissionThisMonth: commission[String(s._id)] ?? 0 }),
    };
  });
  return { today, rows };
}

// One person's pay. The front desk only gets the pay setup (current + upcoming + open request), not the history.
export async function getStaffPay(ctx, staffId) {
  const staff = await findStaff(ctx, staffId);
  const today = await todayAt(staff.branchId);
  const isOwner = ctx.role === 'OWNER';

  const [plans, requests, serviceRates] = await Promise.all([
    PayPlan.find(scoped(ctx, { staffId: staff._id })).sort({ effectiveFrom: -1 }).populate('createdBy', 'name').lean(),
    PayChangeRequest.find(scoped(ctx, { staffId: staff._id, ...(isOwner ? {} : { status: 'pending' }) }))
      .sort({ createdAt: -1 })
      .limit(10)
      .lean(),
    CommissionRule.find(scoped(ctx, { staffId: staff._id })).populate('serviceId', 'name').lean(),
  ]);

  return {
    staff: { _id: staff._id, name: staff.name, role: staff.role, status: staff.status, branchId: staff.branchId },
    today,
    ...currentAndUpcoming(plans, today),
    history: isOwner ? plans.map((p) => ({ ...p, status: planStatus(p, today) })) : undefined,
    requests,
    serviceRates: serviceRates.sort((a, b) => (a.serviceId?.name ?? '').localeCompare(b.serviceId?.name ?? '')),
  };
}

// Requests at the branches this user may use. status: 'pending' (default) or 'all'
export function listRequests(ctx, { status }) {
  const filter = scoped(ctx, { branchId: { $in: ctx.allowedBranchIds } });
  if (status === 'pending') filter.status = 'pending';
  return PayChangeRequest.find(filter).sort({ createdAt: -1 }).limit(100).populate('branchId', 'name').lean();
}

// ---------------------------------------------------------------------------
// Owners: change pay directly
// ---------------------------------------------------------------------------

export async function createPlan(ctx, staffId, input) {
  const staff = await findStaff(ctx, staffId);

  const plan = await mongoose.connection.transaction(async (session) => {
    const { plan, previous, before } = await insertPlan(ctx, staff, input, session);
    const summary = previous
      ? `Changed ${staff.name}'s pay to ${startsOn(plan)} (was ${describePay(previous)}).`
      : `Set ${staff.name}'s pay: ${startsOn(plan)}.`;
    await recordChange(ctx, { action: 'pay_plan.created', staff, summary: withNote(summary, input.note), before, after: payValues(plan) }, session);
    return plan;
  });
  await catchUpCommission(ctx, plan, staff);
  return plan;
}

// Edit a pay change that hasn't started yet
export async function updatePlan(ctx, id, input) {
  const { plan, staff, today } = await findEditablePlan(ctx, id);
  if (planStatus(plan, today) !== 'upcoming') {
    throw new AppError(409, 'PLAN_STARTED', 'This pay setup has already started, so it can’t be edited. Add a new pay change instead.');
  }

  await mongoose.connection.transaction(async (session) => {
    const previous = await PayPlan.findOne(scoped(ctx, { staffId: staff._id, effectiveFrom: { $lt: plan.effectiveFrom } }))
      .sort({ effectiveFrom: -1 })
      .session(session);
    // The previous plan ends the day before this one starts, wherever the new start date is
    if (checkNewStart(previous, input.effectiveFrom, staff.name) || previous?.endReason === 'replaced') {
      previous.effectiveTo = dayBefore(input.effectiveFrom);
      previous.endReason = 'replaced';
      await previous.save({ session });
    }

    const before = payValues(plan);
    const oldWording = startsOn(plan);
    plan.set({ ...cleanPayParts(input), effectiveFrom: input.effectiveFrom, note: input.note });
    await plan.save({ session });

    const summary = `Edited ${staff.name}'s upcoming pay change: now ${startsOn(plan)} (was ${oldWording}).`;
    await recordChange(ctx, { action: 'pay_plan.edited', staff, summary: withNote(summary, input.note), before, after: payValues(plan) }, session);
  });
  await catchUpCommission(ctx, plan, staff);
  return plan;
}

// Cancel a pay change that hasn't started yet. The previous setup simply carries on.
export async function cancelPlan(ctx, id) {
  const { plan, staff, today } = await findEditablePlan(ctx, id);
  if (planStatus(plan, today) !== 'upcoming') {
    throw new AppError(409, 'PLAN_STARTED', 'This pay setup has already started. To stop it, end it instead.');
  }

  await mongoose.connection.transaction(async (session) => {
    const previous = await PayPlan.findOne(scoped(ctx, { staffId: staff._id, effectiveFrom: { $lt: plan.effectiveFrom } }))
      .sort({ effectiveFrom: -1 })
      .session(session);
    if (previous?.endReason === 'replaced') {
      previous.effectiveTo = null;
      previous.endReason = null;
      await previous.save({ session });
    }
    await PayPlan.deleteOne({ _id: plan._id }, { session });

    const summary = `Cancelled ${staff.name}'s upcoming pay change (${startsOn(plan)}).`;
    await recordChange(ctx, { action: 'pay_plan.cancelled', staff, summary, before: payValues(plan), after: null }, session);
  });
}

// Stop paying from a date, e.g. someone is leaving. Their earned pay up to that day is still owed.
export async function endPlan(ctx, id, { effectiveTo }) {
  const { plan, staff, today } = await findEditablePlan(ctx, id);
  if (planStatus(plan, today) === 'upcoming') {
    throw new AppError(409, 'PLAN_NOT_STARTED', 'This pay change hasn’t started yet. Cancel it instead.');
  }
  if (effectiveTo < plan.effectiveFrom) {
    throw new AppError(400, 'VALIDATION_ERROR', `The last day can’t be before the pay setup started (${formatDay(plan.effectiveFrom)})`);
  }

  return mongoose.connection.transaction(async (session) => {
    const before = payValues(plan);
    plan.effectiveTo = effectiveTo;
    plan.endReason = 'ended';
    await plan.save({ session });

    const summary = `Ended ${staff.name}'s pay (${describePay(plan)}). Last day: ${formatDay(effectiveTo)}.`;
    await recordChange(ctx, { action: 'pay_plan.ended', staff, summary, before, after: payValues(plan) }, session);
    return plan;
  });
}

// ---------------------------------------------------------------------------
// Front desk requests, approved by an owner
// ---------------------------------------------------------------------------

export async function createRequest(ctx, input) {
  const staff = await findStaff(ctx, input.staffId);
  const proposed = { ...cleanPayParts(input), effectiveFrom: input.effectiveFrom };

  // Check the date now for quick feedback; it's checked again when an owner approves
  const [latest, plans, today] = await Promise.all([
    latestPlan(ctx, staff._id).lean(),
    PayPlan.find(scoped(ctx, { staffId: staff._id })).lean(),
    todayAt(staff.branchId),
  ]);
  checkNewStart(latest, input.effectiveFrom, staff.name);
  const { current } = currentAndUpcoming(plans, today);

  try {
    return await mongoose.connection.transaction(async (session) => {
      const [request] = await PayChangeRequest.create(
        [
          {
            orgId: ctx.orgId,
            branchId: staff.branchId,
            staffId: staff._id,
            staffName: staff.name,
            proposed,
            currentSummary: describePay(current),
            note: input.note,
            requestedBy: ctx.userId,
            requestedByName: ctx.userName,
          },
        ],
        { session }
      );

      const summary = `Asked to change ${staff.name}'s pay to ${startsOn(proposed)} (now ${describePay(current)}). Reason: ${input.note}`;
      await logActivity(ctx, { action: 'pay_request.created', branchId: staff.branchId, staffId: staff._id, summary, before: payValues(current), after: payValues(proposed) }, session);
      await notify(ctx, await branchApproverIds(ctx, staff.branchId), { message: `${ctx.userName} (Front desk): ${summary}`, link: REQUESTS_LINK }, session);
      return request;
    });
  } catch (err) {
    // The unique index allows only one open request per staff member
    if (err.code === 11000) throw new AppError(409, 'REQUEST_PENDING', `There’s already a pay change request waiting for ${staff.name}.`);
    throw err;
  }
}

// An open request at a branch this user may use
async function findPendingRequest(ctx, id) {
  const request = await PayChangeRequest.findOne(scoped(ctx, { _id: id })).lean();
  if (!request || !ctx.allowedBranchIds.includes(String(request.branchId))) {
    throw new AppError(404, 'NOT_FOUND', 'Request not found');
  }
  if (request.status !== 'pending') throw new AppError(409, 'REQUEST_CLOSED', `This request was already ${request.status}.`);
  return request;
}

// Close the request, but only if nobody else closed it in the meantime
async function closeRequest(ctx, request, update, session) {
  const result = await PayChangeRequest.updateOne(
    { _id: request._id, status: 'pending' },
    { $set: { ...update, decidedBy: ctx.userId, decidedByName: ctx.userName, decidedAt: new Date() } },
    { session }
  );
  if (result.modifiedCount !== 1) throw new AppError(409, 'REQUEST_CLOSED', 'Someone else has already answered this request.');
}

export async function approveRequest(ctx, id, { note }) {
  const request = await findPendingRequest(ctx, id);
  const staff = await findStaff(ctx, request.staffId);

  const plan = await mongoose.connection.transaction(async (session) => {
    const { plan, previous, before } = await insertPlan(ctx, staff, { ...request.proposed, note: request.note }, session, { requestId: request._id });
    await closeRequest(ctx, request, { status: 'approved', decisionNote: note, planId: plan._id }, session);

    const summary = `Approved ${request.requestedByName}'s request: ${staff.name}'s pay is now ${startsOn(plan)} (was ${describePay(previous)}).`;
    await recordChange(ctx, { action: 'pay_request.approved', staff, summary: withNote(summary, note), before, after: payValues(plan) }, session);
    await notify(ctx, [request.requestedBy], { message: `${ctx.userName} approved your pay change for ${staff.name}: ${startsOn(plan)}.`, link: REQUESTS_LINK }, session);
    return plan;
  });
  await catchUpCommission(ctx, plan, staff);
  return plan;
}

export async function rejectRequest(ctx, id, { note }) {
  const request = await findPendingRequest(ctx, id);
  const staff = await findStaff(ctx, request.staffId);

  await mongoose.connection.transaction(async (session) => {
    await closeRequest(ctx, request, { status: 'rejected', decisionNote: note }, session);

    const summary = `Did not approve ${request.requestedByName}'s request to change ${staff.name}'s pay to ${startsOn(request.proposed)}.`;
    await recordChange(ctx, { action: 'pay_request.rejected', staff, summary: withNote(summary, note), before: null, after: null }, session);
    await notify(ctx, [request.requestedBy], { message: withNote(`${ctx.userName} did not approve your pay change for ${staff.name}.`, note), link: REQUESTS_LINK }, session);
  });
}

// The front desk person who asked can withdraw their own open request
export async function cancelRequest(ctx, id) {
  const request = await findPendingRequest(ctx, id);
  if (String(request.requestedBy) !== ctx.userId) throw new AppError(403, 'FORBIDDEN', 'Only the person who sent this request can withdraw it');

  await mongoose.connection.transaction(async (session) => {
    await closeRequest(ctx, request, { status: 'cancelled' }, session);
    const summary = `Withdrew the request to change ${request.staffName}'s pay to ${startsOn(request.proposed)}.`;
    await logActivity(ctx, { action: 'pay_request.cancelled', branchId: request.branchId, staffId: request.staffId, summary }, session);
  });
}

// ---------------------------------------------------------------------------
// Commission: special rates per service, and what was earned
// ---------------------------------------------------------------------------

// Owners only: one month of commission lines for one person
export async function getCommission(ctx, staffId, month) {
  const staff = await findStaff(ctx, staffId);
  return monthCommission(ctx, staff._id, month);
}

async function findService(ctx, serviceId) {
  const service = await Service.findOne(scoped(ctx, { _id: serviceId })).select('name').lean();
  if (!service) throw new AppError(404, 'NOT_FOUND', 'Service not found');
  return service;
}

// The person's normal % today, in words, for the activity log
async function normalRate(ctx, staff) {
  const today = await todayAt(staff.branchId);
  const plans = await PayPlan.find(scoped(ctx, { staffId: staff._id })).lean();
  const { current } = currentAndUpcoming(plans, today);
  return current?.commissionBps ? formatPercent(current.commissionBps) : 'no commission';
}

// Add or change a special rate, e.g. Rahul gets 15% on Hair Colour. It counts from the next paid bill.
export async function setServiceRate(ctx, staffId, serviceId, { rateBps }) {
  const staff = await findStaff(ctx, staffId);
  const service = await findService(ctx, serviceId);
  const normal = await normalRate(ctx, staff);

  return mongoose.connection.transaction(async (session) => {
    const existing = await CommissionRule.findOne(scoped(ctx, { staffId: staff._id, serviceId: service._id })).session(session);
    const rule = existing ?? new CommissionRule({ orgId: ctx.orgId, staffId: staff._id, serviceId: service._id });
    const before = existing ? { service: service.name, rateBps: existing.rateBps } : null;
    rule.set({ rateBps, updatedBy: ctx.userId });
    await rule.save({ session });

    const summary = existing
      ? `Changed ${staff.name}'s commission on ${service.name} from ${formatPercent(before.rateBps)} to ${formatPercent(rateBps)} (normal rate: ${normal}).`
      : `Set ${staff.name}'s commission on ${service.name} to ${formatPercent(rateBps)} (normal rate: ${normal}).`;
    await recordChange(ctx, { action: 'service_rate.set', staff, summary, before, after: { service: service.name, rateBps } }, session);
    return rule;
  });
}

export async function removeServiceRate(ctx, staffId, serviceId) {
  const staff = await findStaff(ctx, staffId);
  const rule = await CommissionRule.findOne(scoped(ctx, { staffId: staff._id, serviceId })).populate('serviceId', 'name');
  if (!rule) throw new AppError(404, 'NOT_FOUND', 'Special rate not found');

  await mongoose.connection.transaction(async (session) => {
    await CommissionRule.deleteOne({ _id: rule._id }, { session });
    const summary = `Removed ${staff.name}'s special commission on ${rule.serviceId.name} (was ${formatPercent(rule.rateBps)}). Their normal rate applies again.`;
    await recordChange(ctx, { action: 'service_rate.removed', staff, summary, before: { service: rule.serviceId.name, rateBps: rule.rateBps }, after: null }, session);
  });
}

function withNote(sentence, note) {
  return note ? `${sentence} Note: ${note}` : sentence;
}
