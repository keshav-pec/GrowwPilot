export const LEAD_STATUS_LABEL = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  INTERESTED: 'Interested',
  APPOINTMENT_BOOKED: 'Appointment booked',
  LOST: 'Lost',
};

export const LEAD_SOURCES = ['Instagram', 'Facebook', 'Google', 'WhatsApp', 'Website', 'Phone', 'Walk-in', 'Referral'];

export const OPEN_LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED'];

// Same rules as the server. "Appointment booked" is missing on purpose: only "Convert" sets it.
export const LEAD_NEXT_STATUSES = {
  NEW: ['CONTACTED', 'INTERESTED', 'LOST'],
  CONTACTED: ['INTERESTED', 'LOST'],
  INTERESTED: ['LOST'],
  APPOINTMENT_BOOKED: [],
  LOST: [],
};

// An open lead whose follow-up time has passed
export function isOverdue(lead) {
  return OPEN_LEAD_STATUSES.includes(lead.status) && lead.nextFollowUpAt && new Date(lead.nextFollowUpAt) < new Date();
}
