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
