import { Branch, CashMovement, CashSession, Payment } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { formatMoney } from '../../utils/money.js';
import { dayRangeUTC, todayInZone } from '../../utils/time.js';
import { runOnce } from '../../middleware/idempotency.js';
import { logActivity } from '../activity/activity.service.js';
import { branchApproverIds, notify } from '../notifications/notifications.service.js';
import { billingPermissions, getBillingSettings } from '../billing/settings.service.js';

// ---------------------------------------------------------------------------
// Daily cash closing (BILLING_PLAN.md, Phase 3), for the branch picked in the branch switcher.
//   Open the day with a float -> cash payments and cash refunds of that day are counted automatically,
//   petty cash in/out is added by hand with a reason -> count the drawer -> the gap is shown -> close.
//   expected = float + cash in - cash out + petty in - petty out;  difference = counted - expected
// A closed day never changes: its figures are saved, and an owner fixes a mistake with an adjustment.
// Cash belongs to the branch-local day it was received; cash taken after closing shows as a warning.
// ---------------------------------------------------------------------------

const LINK = '/app/cash';
const sum = (rows, test) => rows.filter(test).reduce((total, r) => total + r.amount, 0);

async function activeBranch(ctx, session = null) {
  const branch = await Branch.findOne(scoped(ctx, { _id: ctx.activeBranchId })).select('name timezone').session(session).lean();
  if (!branch) throw new AppError(404, 'NOT_FOUND', 'Branch not found');
  return branch;
}

async function loadDay(ctx, id, session = null) {
  const day = await CashSession.findOne(scoped(ctx, { _id: id })).session(session).lean();
  if (!day || !ctx.allowedBranchIds.includes(String(day.branchId))) throw new AppError(404, 'NOT_FOUND', 'Cash day not found');
  return day;
}

// The figures of one cash day: saved ones once closed, worked out live while open
async function figures(day, timezone, session = null) {
  const range = dayRangeUTC(day.day, timezone);
  const payments = await Payment.find({ orgId: day.orgId, branchId: day.branchId, method: 'CASH', status: 'VALID', receivedAt: { $gte: range.start, $lt: range.end } })
    .select('kind amount receivedAt')
    .session(session)
    .lean();
  const movements = await CashMovement.find({ sessionId: day._id }).sort({ createdAt: 1 }).session(session).lean();
  const adjustments = sum(movements, (m) => m.kind === 'ADJUSTMENT');

  if (day.status === 'CLOSED') {
    const late = payments.filter((p) => p.receivedAt > day.closedAt);
    const lateCash = sum(late, (p) => p.kind === 'RECEIPT') - sum(late, (p) => p.kind === 'REFUND');
    return {
      cashIn: day.cashIn,
      cashOut: day.cashOut,
      pettyIn: day.pettyIn,
      pettyOut: day.pettyOut,
      expectedCash: day.expectedCash,
      countedCash: day.countedCash,
      difference: day.difference,
      adjustments,
      differenceAfterAdjustments: day.difference - adjustments,
      lateCash,
      movements,
    };
  }
  const cashIn = sum(payments, (p) => p.kind === 'RECEIPT');
  const cashOut = sum(payments, (p) => p.kind === 'REFUND');
  const pettyIn = sum(movements, (m) => m.kind === 'PETTY_IN');
  const pettyOut = sum(movements, (m) => m.kind === 'PETTY_OUT');
  return { cashIn, cashOut, pettyIn, pettyOut, expectedCash: day.openingFloat + cashIn - cashOut + pettyIn - pettyOut, movements };
}

const withFigures = async (day, timezone, session) => ({ ...day, ...(await figures(day, timezone, session)) });

// ---------------------------------------------------------------------------
// The cash screen: the day that is open (or today's), a suggested float, recent days and what I may do
// ---------------------------------------------------------------------------
export async function currentCashDay(ctx) {
  const branch = await activeBranch(ctx);
  const today = todayInZone(branch.timezone);
  const settings = await getBillingSettings(ctx);
  const can = billingPermissions(ctx, settings);

  const open = await CashSession.findOne(scoped(ctx, { branchId: branch._id, status: 'OPEN' })).lean();
  const current = open ?? (await CashSession.findOne(scoped(ctx, { branchId: branch._id, day: today })).lean());
  const lastClosed = await CashSession.findOne(scoped(ctx, { branchId: branch._id, status: 'CLOSED' })).sort({ day: -1 }).lean();
  const recent = await CashSession.find(scoped(ctx, { branchId: branch._id, status: 'CLOSED' })).sort({ day: -1 }).limit(14).lean();

  // Cash taken today before anyone opened the day still counts once it's opened
  let cashSoFar = null;
  if (!current) {
    const range = dayRangeUTC(today, branch.timezone);
    const payments = await Payment.find(scoped(ctx, { branchId: branch._id, method: 'CASH', status: 'VALID', receivedAt: { $gte: range.start, $lt: range.end } })).select('kind amount').lean();
    cashSoFar = sum(payments, (p) => p.kind === 'RECEIPT') - sum(payments, (p) => p.kind === 'REFUND');
  }

  return {
    branch: { _id: branch._id, name: branch.name, timezone: branch.timezone },
    today,
    session: current ? await withFigures(current, branch.timezone) : null,
    suggestedFloat: lastClosed?.countedCash ?? 0,
    cashSoFar,
    recent: await Promise.all(recent.map((d) => withFigures(d, branch.timezone))),
    permissions: { close: can.closeCash, adjust: can.adjustCash },
  };
}

// Open today's cash day at the selected branch with the float in the drawer
export async function openCashDay(ctx, { openingFloat }, key) {
  const branch = await activeBranch(ctx);
  const today = todayInZone(branch.timezone);
  return runOnce(ctx, { key, operation: 'billing.cash.open' }, async (session) => {
    const open = await CashSession.findOne(scoped(ctx, { branchId: branch._id, status: 'OPEN' })).session(session).lean();
    if (open) throw new AppError(409, 'CASH_DAY_OPEN', open.day === today ? 'Today’s cash day is already open' : `The cash day of ${open.day} is still open. Count the drawer and close it first.`);
    if (await CashSession.exists(scoped(ctx, { branchId: branch._id, day: today })).session(session)) throw new AppError(409, 'CASH_DAY_CLOSED', 'Today’s cash day is already closed');

    const [day] = await CashSession.create([{ orgId: ctx.orgId, branchId: branch._id, day: today, openingFloat, openedBy: ctx.userId, openedByName: ctx.userName }], { session });
    await logActivity(ctx, { action: 'billing.cash_opened', branchId: branch._id, summary: `Opened the cash day ${today} at ${branch.name} with a float of ${formatMoney(openingFloat)}` }, session);
    return withFigures(day.toObject(), branch.timezone, session);
  });
}

// Petty cash in or out while the day is open, e.g. ₹200 out for tea
export async function addPettyCash(ctx, id, { kind, amount, reason }, key) {
  await loadDay(ctx, id);
  return runOnce(ctx, { key, operation: 'billing.cash.petty' }, async (session) => {
    const day = await loadDay(ctx, id, session);
    if (day.status !== 'OPEN') throw new AppError(409, 'CASH_DAY_CLOSED', 'This cash day is closed. An owner can add an adjustment instead.');
    await CashMovement.create([{ orgId: ctx.orgId, branchId: day.branchId, sessionId: day._id, kind, amount, reason, byId: ctx.userId, byName: ctx.userName }], { session });
    // Touch the day, so someone closing it at this moment works with the new figures (or tries again)
    await CashSession.updateOne({ _id: day._id, status: 'OPEN' }, { $inc: { version: 1 } }, { session });
    await logActivity(ctx, { action: 'billing.petty_cash', branchId: day.branchId, summary: `Petty cash ${kind === 'PETTY_IN' ? 'in' : 'out'} ${formatMoney(amount)} on ${day.day}: ${reason}` }, session);
    const branch = await Branch.findById(day.branchId).select('timezone').session(session).lean();
    return withFigures({ ...day, version: day.version + 1 }, branch.timezone, session);
  });
}

// Count the drawer and close the day. The difference needs a note.
export async function closeCashDay(ctx, id, { countedCash, note, version }, key) {
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).closeCash) throw new AppError(403, 'FORBIDDEN', 'Only an owner can close the cash day here');
  await loadDay(ctx, id);
  return runOnce(ctx, { key, operation: 'billing.cash.close' }, async (session) => {
    const day = await loadDay(ctx, id, session);
    if (day.status !== 'OPEN') throw new AppError(409, 'CASH_DAY_CLOSED', 'This cash day is already closed');
    if (version !== undefined && day.version !== version) throw new AppError(409, 'STALE_VERSION', 'Petty cash was just added. Check the figures and close again.');
    const branch = await Branch.findById(day.branchId).select('name timezone').session(session).lean();
    const live = await figures(day, branch.timezone, session);
    const difference = countedCash - live.expectedCash;
    if (difference !== 0 && !note?.trim()) throw new AppError(400, 'REASON_REQUIRED', `The drawer is ${formatMoney(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}. Add a note saying why.`);

    const closed = await CashSession.findOneAndUpdate(
      { _id: day._id, status: 'OPEN', version: day.version },
      {
        $set: {
          status: 'CLOSED',
          cashIn: live.cashIn,
          cashOut: live.cashOut,
          pettyIn: live.pettyIn,
          pettyOut: live.pettyOut,
          expectedCash: live.expectedCash,
          countedCash,
          difference,
          closeNote: note?.trim() || undefined,
          closedBy: ctx.userId,
          closedByName: ctx.userName,
          closedAt: new Date(),
        },
        $inc: { version: 1 },
      },
      { returnDocument: 'after', session }
    ).lean();
    if (!closed) throw new AppError(409, 'STALE_VERSION', 'This cash day was just changed. Check the figures and close again.');

    const gap = difference === 0 ? 'matches' : `${formatMoney(Math.abs(difference))} ${difference < 0 ? 'short' : 'over'}`;
    const summary = `Closed the cash day ${day.day} at ${branch.name}: expected ${formatMoney(live.expectedCash)}, counted ${formatMoney(countedCash)} (${gap})${note?.trim() ? `. Note: ${note.trim()}` : ''}`;
    await logActivity(ctx, { action: 'billing.cash_closed', branchId: day.branchId, summary, after: { expectedCash: live.expectedCash, countedCash, difference } }, session);
    if (difference !== 0) await notify(ctx, await branchApproverIds(ctx, day.branchId), { message: `${ctx.userName}: ${summary}`, link: LINK }, session);
    return withFigures(closed, branch.timezone, session);
  });
}

// Owners: a correction to a closed day (plus or minus), e.g. a cash payment that was recorded as UPI
export async function adjustCashDay(ctx, id, { amount, reason }, key) {
  const settings = await getBillingSettings(ctx);
  if (!billingPermissions(ctx, settings).adjustCash) throw new AppError(403, 'FORBIDDEN', 'Only an owner can adjust a closed cash day');
  await loadDay(ctx, id);
  return runOnce(ctx, { key, operation: 'billing.cash.adjust' }, async (session) => {
    const day = await loadDay(ctx, id, session);
    if (day.status !== 'CLOSED') throw new AppError(409, 'CASH_DAY_OPEN', 'This cash day is still open. Use petty cash, or close it first.');
    await CashMovement.create([{ orgId: ctx.orgId, branchId: day.branchId, sessionId: day._id, kind: 'ADJUSTMENT', amount, reason, byId: ctx.userId, byName: ctx.userName }], { session });
    await logActivity(ctx, { action: 'billing.cash_adjusted', branchId: day.branchId, summary: `Adjusted the closed cash day ${day.day} by ${amount < 0 ? '-' : '+'}${formatMoney(Math.abs(amount))}: ${reason}` }, session);
    const branch = await Branch.findById(day.branchId).select('timezone').session(session).lean();
    return withFigures(day, branch.timezone, session);
  });
}

// Closed cash days for reports: [{ day, branchId, ...figures }] for the given branches and days
export async function cashDaysBetween(ctx, { branches, from, to }) {
  const days = await CashSession.find(scoped(ctx, { branchId: { $in: branches.map((b) => b._id) }, day: { $gte: from, $lte: to } })).sort({ day: 1 }).lean();
  return Promise.all(days.map((d) => withFigures(d, branches.find((b) => String(b._id) === String(d.branchId)).timezone)));
}
