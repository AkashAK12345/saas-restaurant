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

  // ── Operational foundations (T0-A, for Phases 7–10) ──────────────────────
  // Only the keys consumed by endpoints that exist. Queue/banquet/task flow
  // permissions are added with the flows themselves, not ahead of them.

  // Customers (company-scoped)
  CUSTOMERS_VIEW: 'customers.view',
  CUSTOMERS_CREATE: 'customers.create',
  CUSTOMERS_UPDATE: 'customers.update',

  // Tables (branch-scoped)
  TABLES_VIEW: 'tables.view',
  TABLES_CREATE: 'tables.create',
  TABLES_UPDATE: 'tables.update',

  // Display devices (branch-scoped; staff-side management of screen credentials)
  DISPLAY_DEVICES_VIEW: 'display_devices.view',
  DISPLAY_DEVICES_CREATE: 'display_devices.create',
  DISPLAY_DEVICES_REVOKE: 'display_devices.revoke',

  // Real-time read access (T0-B). These gate the staff SSE ticket routes now
  // and will gate the corresponding read endpoints when each domain lands.
  QUEUE_VIEW: 'queue.view',
  BANQUET_KDS_VIEW: 'banquet.kds.view',
  TASKS_VIEW: 'tasks.view',

  // ── Queue Management (Phase 7) ───────────────────────────────────────────
  // One key per explicit queue operation exposed under /queue-tokens. Table
  // assignment/release is part of seating and is covered by queue.seat.
  QUEUE_REGISTER: 'queue.register',
  QUEUE_CALL: 'queue.call',
  QUEUE_SEAT: 'queue.seat',
  QUEUE_NO_SHOW: 'queue.no_show',
  QUEUE_CANCEL: 'queue.cancel',

  // ── Banquet Management (Phase 8) ─────────────────────────────────────────
  // One read key covers every banquet read; each mutation that changes what a
  // booking MEANS gets its own key. BANQUET_KDS_VIEW (above, from T0-B) still
  // gates the kitchen board and its stream.
  BANQUET_VIEW: 'banquet.view',
  BANQUET_HALL_MANAGE: 'banquet.hall.manage',
  BANQUET_PACKAGE_MANAGE: 'banquet.package.manage',
  BANQUET_BOOKING_CREATE: 'banquet.booking.create',
  BANQUET_BOOKING_UPDATE: 'banquet.booking.update',
  BANQUET_BOOKING_CONFIRM: 'banquet.booking.confirm',
  BANQUET_BOOKING_CANCEL: 'banquet.booking.cancel',
  BANQUET_BOOKING_COMPLETE: 'banquet.booking.complete',
  BANQUET_PAYMENT_CREATE: 'banquet.payment.create',
  BANQUET_EVENT_PLAN_MANAGE: 'banquet.event_plan.manage',
  BANQUET_KDS_MANAGE: 'banquet.kds.manage',
  // Pricing after the snapshot. Separately permissioned because discounts are
  // where revenue leaks: a line or per-head discount is routine, an admin
  // (lump-sum) discount is an override.
  BANQUET_CHARGE_MANAGE: 'banquet.charge.manage',
  BANQUET_DISCOUNT_APPLY: 'banquet.discount.apply',
  BANQUET_DISCOUNT_ADMIN: 'banquet.discount.admin',
  /** Second-person confirmation that a recorded payment was received. */
  BANQUET_PAYMENT_VERIFY: 'banquet.payment.verify',
  /**
   * Change a booking whose event has already started. The reference system
   * reserves this for its Super Admin; SAMCO expresses it as a grantable key
   * (is_superadmin bypasses nothing — see PermissionGuard).
   */
  BANQUET_BOOKING_EDIT_PAST: 'banquet.booking.edit_past',
  /**
   * Edit or re-price a booking that is otherwise locked (completed, or
   * already started) and correct its recorded payments. A Super-Admin-style
   * override, grantable per role rather than tied to any hierarchy — SAMCO
   * has none. Broader than BANQUET_BOOKING_EDIT_PAST: it also lifts the
   * COMPLETED-status lock, not just the already-started-event one.
   */
  BANQUET_BOOKING_EDIT_LOCKED: 'banquet.booking.edit_locked',
  /**
   * Delete a booking outright, payment history and all. A draft needs this
   * key; deleting a CONFIRMED or COMPLETED booking additionally needs
   * BANQUET_BOOKING_EDIT_LOCKED, the Super-Admin-style override. A cancelled
   * booking is never deletable — it already released its hall.
   */
  BANQUET_BOOKING_DELETE: 'banquet.booking.delete',
  /**
   * Ask the kitchen for plates of a dish (plate approval). Deciding and
   * dispatching are kitchen work and use BANQUET_KDS_MANAGE.
   */
  BANQUET_PLATE_REQUEST: 'banquet.plate.request',
  BANQUET_FINANCE_VIEW: 'banquet.finance.view',

  // ── Tasks & Routines (Phase 9) ───────────────────────────────────────────
  // TASKS_VIEW (above, from T0-B) still gates every task read and the `tasks`
  // stream. Each key below maps to exactly one implemented operation.
  /**
   * The narrower read: only tasks the caller is assigned to or raised. A role
   * holding TASKS_VIEW sees the whole branch (the reference system's "admin"
   * mode); one holding only this key sees its own work ("staff" mode); one
   * holding neither sees nothing ("none"). Added alongside TASKS_VIEW rather
   * than narrowing it, so no existing role loses sight of anything.
   */
  TASKS_VIEW_OWN: 'tasks.view_own',
  TASKS_CREATE: 'tasks.create',
  TASKS_UPDATE: 'tasks.update',
  TASKS_ASSIGN: 'tasks.assign',
  TASKS_START: 'tasks.start',
  TASKS_COMPLETE: 'tasks.complete',
  TASKS_CANCEL: 'tasks.cancel',
  TASKS_CHECKLIST_MANAGE: 'tasks.checklist.manage',
  TASKS_ROUTINE_MANAGE: 'tasks.routine.manage',
  TASKS_REPORTS_VIEW: 'tasks.reports.view',

  // ── Point of sale ───────────────────────────────────────────────────────
  // Revenue is its own grant: seeing a branch's checklists or banquets says
  // nothing about whether someone may see its takings.
  POS_REPORTS_VIEW: 'pos.reports.view',

  // ── Reports & Dashboard (Phase 10) ───────────────────────────────────────
  // REPORTS_VIEW (above, reserved since Phase 1) now gates the reporting
  // system itself. It is deliberately NOT sufficient on its own: running a
  // report also requires that report's own domain permission, so "reports"
  // can never become a back door into data a user cannot otherwise see.
  REPORTS_EXPORT: 'reports.export',
  DASHBOARD_VIEW: 'dashboard.view',
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
    description:
      'Manage company lifecycle status (disable and re-enable). The same ' +
      'permission covers both directions so disabling is always recoverable.',
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
    description:
      'Disable or re-enable a user account globally. Distinct from removing a ' +
      'user from a company, which is a membership operation.',
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
    description:
      'Use the reporting system. Each report ALSO requires its own domain ' +
      'permission, so this key alone reveals nothing.',
  },
  {
    name: PERMISSION_KEYS.AUDIT_LOGS_VIEW,
    module: 'audit_logs',
    description: 'View company audit logs',
  },
  {
    name: PERMISSION_KEYS.CUSTOMERS_VIEW,
    module: 'customers',
    description: 'View customers in company',
  },
  {
    name: PERMISSION_KEYS.CUSTOMERS_CREATE,
    module: 'customers',
    description: 'Create customers in company',
  },
  {
    name: PERMISSION_KEYS.CUSTOMERS_UPDATE,
    module: 'customers',
    description: 'Update customer details and status',
  },
  {
    name: PERMISSION_KEYS.TABLES_VIEW,
    module: 'tables',
    description: 'View tables at a branch',
  },
  {
    name: PERMISSION_KEYS.TABLES_CREATE,
    module: 'tables',
    description: 'Create tables at a branch',
  },
  {
    name: PERMISSION_KEYS.TABLES_UPDATE,
    module: 'tables',
    description: 'Update table details and status',
  },
  {
    name: PERMISSION_KEYS.DISPLAY_DEVICES_VIEW,
    module: 'display_devices',
    description: 'View display devices paired to a branch',
  },
  {
    name: PERMISSION_KEYS.DISPLAY_DEVICES_CREATE,
    module: 'display_devices',
    description: 'Pair a new display device to a branch (issues its credential once)',
  },
  {
    name: PERMISSION_KEYS.DISPLAY_DEVICES_REVOKE,
    module: 'display_devices',
    description: 'Revoke a display device credential',
  },
  {
    name: PERMISSION_KEYS.QUEUE_VIEW,
    module: 'queue',
    description: 'View queue state and subscribe to queue updates at a branch',
  },
  {
    name: PERMISSION_KEYS.BANQUET_KDS_VIEW,
    module: 'banquet',
    description: 'View the banquet kitchen display and subscribe to its updates at a branch',
  },
  {
    name: PERMISSION_KEYS.TASKS_VIEW,
    module: 'tasks',
    description: 'View tasks and subscribe to task updates at a branch',
  },
  {
    name: PERMISSION_KEYS.QUEUE_REGISTER,
    module: 'queue',
    description: 'Register a party in the queue (issue a token) at a branch',
  },
  {
    name: PERMISSION_KEYS.QUEUE_CALL,
    module: 'queue',
    description: 'Call a waiting queue token',
  },
  {
    name: PERMISSION_KEYS.QUEUE_SEAT,
    module: 'queue',
    description: 'Seat a called party and assign or release its table',
  },
  {
    name: PERMISSION_KEYS.QUEUE_NO_SHOW,
    module: 'queue',
    description: 'Mark a called queue token as a no-show',
  },
  {
    name: PERMISSION_KEYS.QUEUE_CANCEL,
    module: 'queue',
    description: 'Cancel a waiting or called queue token',
  },
  {
    name: PERMISSION_KEYS.BANQUET_VIEW,
    module: 'banquet',
    description: 'View banquet halls, packages, bookings, payments and event plans at a branch',
  },
  {
    name: PERMISSION_KEYS.BANQUET_HALL_MANAGE,
    module: 'banquet',
    description: 'Create and update banquet halls at a branch',
  },
  {
    name: PERMISSION_KEYS.BANQUET_PACKAGE_MANAGE,
    module: 'banquet',
    description: 'Create and update banquet packages for the company',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_CREATE,
    module: 'banquet',
    description: 'Create a draft banquet booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_UPDATE,
    module: 'banquet',
    description: 'Update the details of a draft banquet booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_CONFIRM,
    module: 'banquet',
    description: 'Confirm a draft booking, claiming its hall for the event window',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_CANCEL,
    module: 'banquet',
    description: 'Cancel a draft or confirmed banquet booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_COMPLETE,
    module: 'banquet',
    description: 'Mark a confirmed banquet event as completed',
  },
  {
    name: PERMISSION_KEYS.BANQUET_PAYMENT_CREATE,
    module: 'banquet',
    description: 'Record an advance or balance payment against a booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_EVENT_PLAN_MANAGE,
    module: 'banquet',
    description: 'Create and update the event plan for a booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_KDS_MANAGE,
    module: 'banquet',
    description: 'Advance kitchen preparation state for banquet items',
  },
  {
    name: PERMISSION_KEYS.BANQUET_CHARGE_MANAGE,
    module: 'banquet',
    description: 'Add or withdraw extra charges (decoration, DJ, extra service) on a booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_DISCOUNT_APPLY,
    module: 'banquet',
    description: 'Add or withdraw line and per-head discounts on a booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_DISCOUNT_ADMIN,
    module: 'banquet',
    description: 'Add or withdraw an admin (lump-sum override) discount on a booking',
  },
  {
    name: PERMISSION_KEYS.BANQUET_PAYMENT_VERIFY,
    module: 'banquet',
    description:
      'Verify that a recorded banquet payment was received. The person who recorded a ' +
      'payment can never verify it.',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_EDIT_PAST,
    module: 'banquet',
    description:
      'Edit or re-price a banquet booking whose event has already started (a ' +
      'revenue-integrity control)',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_EDIT_LOCKED,
    module: 'banquet',
    description:
      'Edit or re-price a banquet booking that is completed or already started, and ' +
      'correct its recorded payments (a Super-Admin-style override)',
  },
  {
    name: PERMISSION_KEYS.BANQUET_BOOKING_DELETE,
    module: 'banquet',
    description:
      'Delete a banquet booking and its payment history outright. Deleting a confirmed or ' +
      'completed booking additionally requires banquet.booking.edit_locked',
  },
  {
    name: PERMISSION_KEYS.BANQUET_PLATE_REQUEST,
    module: 'banquet',
    description:
      'Ask the kitchen for plates of a dish for a confirmed event. Someone else in the ' +
      'kitchen (banquet.kds.manage) approves, rejects and dispatches.',
  },
  {
    name: PERMISSION_KEYS.BANQUET_FINANCE_VIEW,
    module: 'banquet',
    description:
      'View the banquet finance overview: revenue summaries, outstanding balances, and ' +
      'payment history across bookings.',
  },
  {
    name: PERMISSION_KEYS.TASKS_VIEW_OWN,
    module: 'tasks',
    description:
      'View only the tasks assigned to or raised by you at a branch. tasks.view ' +
      'is the wider key and shows every task in the branch.',
  },
  {
    name: PERMISSION_KEYS.TASKS_CREATE,
    module: 'tasks',
    description: 'Create a task at a branch',
  },
  {
    name: PERMISSION_KEYS.TASKS_UPDATE,
    module: 'tasks',
    description: 'Edit an open task and tick its checklist items',
  },
  {
    name: PERMISSION_KEYS.TASKS_ASSIGN,
    module: 'tasks',
    description: 'Assign a task to a member of staff, or clear its assignment',
  },
  {
    name: PERMISSION_KEYS.TASKS_START,
    module: 'tasks',
    description: 'Mark a task as being worked on',
  },
  {
    name: PERMISSION_KEYS.TASKS_COMPLETE,
    module: 'tasks',
    description: 'Complete a task once its required checklist items are done',
  },
  {
    name: PERMISSION_KEYS.TASKS_CANCEL,
    module: 'tasks',
    description: 'Cancel an open task',
  },
  {
    name: PERMISSION_KEYS.TASKS_CHECKLIST_MANAGE,
    module: 'tasks',
    description: 'Create and update reusable checklist templates for the company',
  },
  {
    name: PERMISSION_KEYS.TASKS_ROUTINE_MANAGE,
    module: 'tasks',
    description: 'Create, edit, activate and materialise recurring routines at a branch',
  },
  {
    name: PERMISSION_KEYS.TASKS_REPORTS_VIEW,
    module: 'tasks',
    description: 'View task and routine completion summaries for a branch',
  },
  {
    name: PERMISSION_KEYS.POS_REPORTS_VIEW,
    module: 'pos',
    description: "View a branch's point-of-sale revenue, orders and items sold",
  },
  {
    name: PERMISSION_KEYS.REPORTS_EXPORT,
    module: 'reports',
    description:
      'Download a report as Excel or PDF. Exports carry exactly the data the ' +
      'viewer is already permitted to see.',
  },
  {
    name: PERMISSION_KEYS.DASHBOARD_VIEW,
    module: 'reports',
    description: 'View the operational dashboard for a branch',
  },
];
