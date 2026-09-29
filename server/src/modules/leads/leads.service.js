import { Appointment, Customer, Lead, Service, User } from '../../models/index.js';
import { AppError } from '../../utils/AppError.js';
import { scoped } from '../../utils/scoped.js';
import { escapeRegex } from '../../utils/regex.js';
import { LEAD_TRANSITIONS, assertTransition } from '../../utils/stateMachine.js';
import { newAppointment, prepareBooking, withStaffLock } from '../appointments/scheduling.service.js';

const OPEN_LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED'];
const POPULATE = [
  { path: 'interestedServiceId', select: 'name' },
  { path: 'assignedToUserId', select: 'name' },
];

// People a lead can be assigned to: active owners and front desk users who work at this branch
function assigneeFilter(ctx, branchId) {
  return scoped(ctx, {
    role: { $in: ['OWNER', 'FRONT_DESK'] },
    status: 'active',
    $or: [{ allBranches: true }, { branchIds: branchId }],
  });
}

export function listAssignees(ctx) {
  return User.find(assigneeFilter(ctx, ctx.activeBranchId)).select('name role').sort('name').lean();
}

// Any ids in the request must belong to this salon (and the assignee must work at this branch)
async function checkRefs(ctx, branchId, { interestedServiceId, assignedToUserId }) {
  if (interestedServiceId && !(await Service.exists(scoped(ctx, { _id: interestedServiceId })))) {
    throw new AppError(400, 'INVALID_SERVICE', 'That service was not found');
  }
  if (assignedToUserId && !(await User.exists({ ...assigneeFilter(ctx, branchId), _id: assignedToUserId }))) {
    throw new AppError(400, 'INVALID_ASSIGNEE', 'That person can’t be assigned leads at this branch');
  }
}

// '' from a form means "clear this field"
function toDocument(input) {
  const doc = { ...input };
  for (const key of ['interestedServiceId', 'assignedToUserId']) {
    if (key in input) doc[key] = input[key] || null;
  }
  return doc;
}

async function findLead(ctx, id) {
  const lead = await Lead.findOne(scoped(ctx, { _id: id }));
  if (!lead || !ctx.allowedBranchIds.includes(String(lead.branchId))) throw new AppError(404, 'NOT_FOUND', 'Lead not found');
  return lead;
}

// Leads at the selected branch, newest first
export function listLeads(ctx, { status, source, assignedTo, search, overdue }) {
  const filter = scoped(ctx, { branchId: ctx.activeBranchId });
  if (status) filter.status = status;
  if (source) filter.source = source;
  if (assignedTo) filter.assignedToUserId = assignedTo;
  if (overdue) {
    filter.status = { $in: OPEN_LEAD_STATUSES };
    filter.nextFollowUpAt = { $lt: new Date() };
  }
  if (search) {
    const digits = search.replace(/\D/g, '');
    filter.$or = [{ name: new RegExp(escapeRegex(search), 'i') }];
    if (digits.length >= 3) filter.$or.push({ phone: { $regex: digits } });
  }
  return Lead.find(filter).populate(POPULATE).sort({ createdAt: -1 }).limit(200).lean();
}

// One lead, plus the existing customer with the same phone (if any), so the screen can say
// "Existing customer found: Priya S. The booking will be linked to her profile."
export async function getLead(ctx, id) {
  const lead = await findLead(ctx, id);
  await lead.populate([...POPULATE, { path: 'notes.by', select: 'name' }]);
  const matchingCustomer = await Customer.findOne(scoped(ctx, { phone: lead.phone })).select('name phone').lean();
  return { lead, matchingCustomer };
}

export async function createLead(ctx, { note, ...input }) {
  await checkRefs(ctx, ctx.activeBranchId, input);
  const lead = await Lead.create({
    ...toDocument(input),
    orgId: ctx.orgId,
    branchId: ctx.activeBranchId,
    notes: note ? [{ text: note, by: ctx.userId }] : [],
  });
  return lead.populate(POPULATE);
}

export async function updateLead(ctx, id, input) {
  const lead = await findLead(ctx, id);
  await checkRefs(ctx, lead.branchId, input);
  lead.set(toDocument(input));
  await lead.save();
  return lead.populate(POPULATE);
}

// New -> Contacted -> Interested, or -> Lost. "Appointment booked" is only set by convertLead.
export async function setLeadStatus(ctx, id, status) {
  const lead = await findLead(ctx, id);
  assertTransition(LEAD_TRANSITIONS, lead.status, status);

  // Only update if the status is still what we just read (two people clicking at once)
  const updated = await Lead.findOneAndUpdate(scoped(ctx, { _id: id, status: lead.status }), { $set: { status } }, { new: true }).populate(POPULATE);
  if (!updated) throw new AppError(409, 'STATUS_CHANGED', 'This lead was just updated by someone else. Please refresh.');
  return updated;
}

// Adds an entry to the notes timeline, with who wrote it and when
export async function addNote(ctx, id, text) {
  await findLead(ctx, id);
  const updated = await Lead.findOneAndUpdate(
    scoped(ctx, { _id: id }),
    { $push: { notes: { text, by: ctx.userId, at: new Date() } } },
    { new: true }
  ).populate([...POPULATE, { path: 'notes.by', select: 'name' }]);
  return updated;
}

// ---------------------------------------------------------------------------
// Convert to appointment. ONE transaction does all of this:
//   1. find the customer by phone in this salon: link to them, or create them
//   2. book with the same stylist lock + clash check as any booking
//   3. mark the lead "Appointment booked" and save the customer and appointment on it
// If any step fails (e.g. the slot is taken), NOTHING is saved: no customer, no booking, lead unchanged.
// ---------------------------------------------------------------------------
export async function convertLead(ctx, id, payload) {
  const lead = await findLead(ctx, id);
  if (!OPEN_LEAD_STATUSES.includes(lead.status)) {
    throw new AppError(409, 'LEAD_CLOSED', 'This lead has already been converted or marked lost');
  }

  // Checks that don't need the database lock (services, stylists, opening hours...)
  const booking = await prepareBooking(ctx, { ...payload, branchId: lead.branchId });

  return withStaffLock(ctx, booking.branch, booking.items, async (session) => {
    // 1. Customer: look up by phone again INSIDE the transaction, create only if missing
    let customer = await Customer.findOne(scoped(ctx, { phone: lead.phone })).session(session);
    const isExistingCustomer = Boolean(customer);
    if (!customer) {
      [customer] = await Customer.create([{ orgId: ctx.orgId, name: lead.name, phone: lead.phone }], { session });
    }

    // 2. The appointment
    const [appointment] = await Appointment.create(
      [newAppointment(ctx, { ...booking, customer }, { ...payload, source: 'lead', leadId: lead._id })],
      { session }
    );

    // 3. The lead (only if it's still open: someone may have marked it lost meanwhile)
    const updatedLead = await Lead.findOneAndUpdate(
      scoped(ctx, { _id: lead._id, status: { $in: OPEN_LEAD_STATUSES } }),
      {
        $set: { status: 'APPOINTMENT_BOOKED', customerId: customer._id, appointmentId: appointment._id },
        $push: { notes: { text: 'Converted to an appointment', by: ctx.userId, at: new Date() } },
      },
      { new: true, session }
    );
    if (!updatedLead) throw new AppError(409, 'LEAD_CLOSED', 'This lead was just changed by someone else. Please refresh.');

    return { lead: updatedLead, appointment, customer, isExistingCustomer };
  });
}
