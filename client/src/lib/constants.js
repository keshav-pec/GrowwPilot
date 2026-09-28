export const ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OWNER: 'OWNER',
  FRONT_DESK: 'FRONT_DESK',
};

// Where each role lands after login
export const ROLE_HOME = {
  SUPER_ADMIN: '/admin/salons',
  OWNER: '/app/dashboard',
  FRONT_DESK: '/app/today',
};

export const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  OWNER: 'Owner',
  FRONT_DESK: 'Front Desk',
};

// localStorage key for the branch picked in the branch switcher
export const BRANCH_STORAGE_KEY = 'gp_branch';

export const PLANS = [
  { value: 'trial', label: 'Trial' },
  { value: 'basic', label: 'Basic' },
  { value: 'pro', label: 'Pro' },
];

// Common timezones for branches (the server accepts any valid IANA timezone)
export const TIMEZONES = [
  { value: 'Asia/Kolkata', label: 'India (Asia/Kolkata)' },
  { value: 'Asia/Dubai', label: 'UAE (Asia/Dubai)' },
  { value: 'Asia/Singapore', label: 'Singapore (Asia/Singapore)' },
  { value: 'Asia/Kathmandu', label: 'Nepal (Asia/Kathmandu)' },
  { value: 'Europe/London', label: 'UK (Europe/London)' },
  { value: 'America/New_York', label: 'US East (America/New_York)' },
];
