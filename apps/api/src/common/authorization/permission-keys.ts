// System-defined permission keys.
// Clients cannot create arbitrary permission definitions.
// This file is the single source of truth for all capability names.

export const PERMISSION_KEYS = {
  // Company management
  COMPANIES_VIEW: 'companies.view',
  COMPANIES_UPDATE: 'companies.update',
  COMPANIES_DISABLE: 'companies.disable',

  // Branch management
  BRANCHES_VIEW: 'branches.view',
  BRANCHES_CREATE: 'branches.create',
  BRANCHES_UPDATE: 'branches.update',
  BRANCHES_DISABLE: 'branches.disable',

  // Membership management
  MEMBERSHIPS_VIEW: 'memberships.view',
  MEMBERSHIPS_CREATE: 'memberships.create',
  MEMBERSHIPS_UPDATE: 'memberships.update',

  // Role management
  ROLES_VIEW: 'roles.view',
  ROLES_CREATE: 'roles.create',
  ROLES_UPDATE: 'roles.update',

  // User management
  USERS_VIEW: 'users.view',
  USERS_CREATE: 'users.create',
  USERS_UPDATE: 'users.update',
  USERS_DISABLE: 'users.disable',

  // POS (future)
  POS_ORDER_CREATE: 'pos.order.create',
  POS_ORDER_UPDATE: 'pos.order.update',
  POS_ORDER_CANCEL: 'pos.order.cancel',
  POS_PAYMENT_CREATE: 'pos.payment.create',
  POS_REFUND: 'pos.refund',

  // Inventory (future)
  INVENTORY_STOCK_VIEW: 'inventory.stock.view',
  INVENTORY_STOCK_ADJUST: 'inventory.stock.adjust',
  INVENTORY_TRANSFER: 'inventory.transfer',

  // Finance (future)
  FINANCE_EXPENSE_CREATE: 'finance.expense.create',
  FINANCE_EXPENSE_APPROVE: 'finance.expense.approve',

  // Reports (future)
  REPORTS_VIEW: 'reports.view',

  // Audit Logs
  AUDIT_LOGS_VIEW: 'audit_logs.view',
} as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[keyof typeof PERMISSION_KEYS];

// Canonical list used by the seed script and for validation in role permission assignment.
export const SYSTEM_PERMISSIONS: Array<{
  name: PermissionKey;
  module: string;
  description: string;
}> = [
  {
    name: PERMISSION_KEYS.COMPANIES_VIEW,
    module: 'companies',
    description: 'View company details',
  },
  {
    name: PERMISSION_KEYS.COMPANIES_UPDATE,
    module: 'companies',
    description: 'Update company details and settings',
  },
  {
    name: PERMISSION_KEYS.COMPANIES_DISABLE,
    module: 'companies',
    description: 'Disable or suspend a company',
  },
  {
    name: PERMISSION_KEYS.BRANCHES_VIEW,
    module: 'branches',
    description: 'View branches in company',
  },
  {
    name: PERMISSION_KEYS.BRANCHES_CREATE,
    module: 'branches',
    description: 'Create new branches in company',
  },
  {
    name: PERMISSION_KEYS.BRANCHES_UPDATE,
    module: 'branches',
    description: 'Update branch details',
  },
  {
    name: PERMISSION_KEYS.BRANCHES_DISABLE,
    module: 'branches',
    description: 'Disable or re-enable a branch',
  },
  {
    name: PERMISSION_KEYS.MEMBERSHIPS_VIEW,
    module: 'memberships',
    description: 'View company member list',
  },
  {
    name: PERMISSION_KEYS.MEMBERSHIPS_CREATE,
    module: 'memberships',
    description: 'Add users to company',
  },
  {
    name: PERMISSION_KEYS.MEMBERSHIPS_UPDATE,
    module: 'memberships',
    description: 'Update membership status',
  },
  {
    name: PERMISSION_KEYS.ROLES_VIEW,
    module: 'roles',
    description: 'View roles in company',
  },
  {
    name: PERMISSION_KEYS.ROLES_CREATE,
    module: 'roles',
    description: 'Create roles in company',
  },
  {
    name: PERMISSION_KEYS.ROLES_UPDATE,
    module: 'roles',
    description: 'Update roles and assign permissions to roles',
  },
  {
    name: PERMISSION_KEYS.USERS_VIEW,
    module: 'users',
    description: 'View users in company',
  },
  {
    name: PERMISSION_KEYS.USERS_CREATE,
    module: 'users',
    description: 'Create new user accounts',
  },
  {
    name: PERMISSION_KEYS.USERS_UPDATE,
    module: 'users',
    description: 'Update user details and branch role assignments',
  },
  {
    name: PERMISSION_KEYS.USERS_DISABLE,
    module: 'users',
    description: 'Disable or re-enable user accounts',
  },
  {
    name: PERMISSION_KEYS.POS_ORDER_CREATE,
    module: 'pos',
    description: 'Create POS orders',
  },
  {
    name: PERMISSION_KEYS.POS_ORDER_UPDATE,
    module: 'pos',
    description: 'Update POS orders',
  },
  {
    name: PERMISSION_KEYS.POS_ORDER_CANCEL,
    module: 'pos',
    description: 'Cancel POS orders',
  },
  {
    name: PERMISSION_KEYS.POS_PAYMENT_CREATE,
    module: 'pos',
    description: 'Process payments',
  },
  {
    name: PERMISSION_KEYS.POS_REFUND,
    module: 'pos',
    description: 'Issue refunds',
  },
  {
    name: PERMISSION_KEYS.INVENTORY_STOCK_VIEW,
    module: 'inventory',
    description: 'View stock levels',
  },
  {
    name: PERMISSION_KEYS.INVENTORY_STOCK_ADJUST,
    module: 'inventory',
    description: 'Adjust stock levels',
  },
  {
    name: PERMISSION_KEYS.INVENTORY_TRANSFER,
    module: 'inventory',
    description: 'Transfer stock between locations',
  },
  {
    name: PERMISSION_KEYS.FINANCE_EXPENSE_CREATE,
    module: 'finance',
    description: 'Create petty cash expenses',
  },
  {
    name: PERMISSION_KEYS.FINANCE_EXPENSE_APPROVE,
    module: 'finance',
    description: 'Approve expenses',
  },
  {
    name: PERMISSION_KEYS.REPORTS_VIEW,
    module: 'reports',
    description: 'View reports',
  },
  {
    name: PERMISSION_KEYS.AUDIT_LOGS_VIEW,
    module: 'audit_logs',
    description: 'View company audit logs',
  },
];
