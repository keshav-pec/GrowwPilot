// All the fixed lists of values used across the app, in one place.

// INVENTORY = a stock-keeping login for one branch (Inventory add-on only)
export const ROLES = ['SUPER_ADMIN', 'OWNER', 'FRONT_DESK', 'INVENTORY'];

// Team members: SERVICE = stylists and beauticians (can be booked), FRONT_DESK = reception (paid, never booked)
export const STAFF_KINDS = ['SERVICE', 'FRONT_DESK'];
// Query part for "stylists only". Uses $ne so team members saved before `kind` existed still count.
export const SERVICE_STAFF = { kind: { $ne: 'FRONT_DESK' } };

export const APPOINTMENT_STATUSES = ['BOOKED', 'ARRIVED', 'IN_SERVICE', 'COMPLETED', 'CANCELLED'];
export const APPOINTMENT_SOURCES = ['phone', 'walk-in', 'lead'];

export const LEAD_STATUSES = ['NEW', 'CONTACTED', 'INTERESTED', 'APPOINTMENT_BOOKED', 'LOST'];
export const LEAD_SOURCES = ['Instagram', 'Facebook', 'Google', 'WhatsApp', 'Website', 'Phone', 'Walk-in', 'Referral'];

// How a customer pays a bill. OTHER = anything else (e.g. a voucher), with a note in the reference.
export const PAYMENT_METHODS = ['CASH', 'UPI', 'CARD', 'OTHER'];
export const ATTENDANCE_STATUSES = ['present', 'absent', 'leave'];
export const PLANS = ['trial', 'basic', 'pro'];

// How a staff member is paid (payroll). HYBRID = any mix of the pay parts.
export const PAY_MODELS = ['FIXED', 'FIXED_COMMISSION', 'COMMISSION', 'DAILY', 'HOURLY', 'ASSIGNMENT', 'HYBRID'];
export const PAY_REQUEST_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'];
export const SALARY_PAYMENT_METHODS = ['CASH', 'UPI', 'BANK'];

// Appointments that still "hold" a stylist's time (not finished, not cancelled)
export const OPEN_APPOINTMENT_STATUSES = ['BOOKED', 'ARRIVED', 'IN_SERVICE'];
