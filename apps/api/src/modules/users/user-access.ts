import { PERMISSION_KEYS, type PermissionKey } from '../../common/authorization/permission-keys.js';

/**
 * User access — the toggles on the User Management form, and what each one
 * grants.
 *
 * A person's access is chosen as toggles (the reference design's model), and
 * enforced as permission keys: saving a user turns their selection into the
 * permission set of a role that belongs to them alone (see UserAccessService).
 * Every endpoint keeps checking keys exactly as before.
 *
 * Some toggles name features SAMCO does not have yet (POS, petty cash, asset
 * tracking…). They are saved with the user and grant nothing today; when a
 * feature lands, its keys are added to its toggle here and every user who
 * already has it switched on gains them on their next save.
 *
 * The selection itself is stored, not re-derived from keys, because several
 * toggles share keys (the admin and customer displays both read the queue)
 * and could not be told apart afterwards.
 */

export const USER_TYPES = ['ADMIN', 'MANAGER', 'STAFF'] as const;
export type UserTypeKey = (typeof USER_TYPES)[number];

export const ROUTINE_LEVELS = ['STAFF', 'MANAGER'] as const;
export type RoutineLevel = (typeof ROUTINE_LEVELS)[number];

export const TASK_MODES = ['OFF', 'RECEIVE', 'BOTH'] as const;
export type TaskMode = (typeof TASK_MODES)[number];

export interface AccessSelection {
  /** Keys of the switched-on toggles. */
  toggles: string[];
  /** Daily form key → level; a form left out is Off. */
  routines: Record<string, RoutineLevel>;
  tasks: TaskMode;
}

export interface AccessToggle {
  key: string;
  label: string;
  /** What switching it on grants. Empty: the feature is not built yet. */
  permissions: readonly PermissionKey[];
}

export interface AccessSection {
  key: string;
  title: string;
  toggles: readonly AccessToggle[];
}

const K = PERMISSION_KEYS;

const toggle = (key: string, label: string, permissions: readonly PermissionKey[] = []): AccessToggle => ({
  key,
  label,
  permissions,
});

/** The toggle sections, in the reference design's order. */
export const ACCESS_SECTIONS: readonly AccessSection[] = [
  {
    key: 'queue',
    title: 'Queue & Podium',
    toggles: [
      toggle('queue.admin_display', 'Admin Display', [K.QUEUE_VIEW]),
      toggle('queue.podium', 'Podium Operator', [
        K.QUEUE_VIEW,
        K.QUEUE_REGISTER,
        K.QUEUE_CALL,
        K.QUEUE_SEAT,
        K.QUEUE_NO_SHOW,
        K.QUEUE_CANCEL,
        K.CUSTOMERS_VIEW,
      ]),
      toggle('queue.register', 'Customer Register', [K.QUEUE_REGISTER]),
      toggle('queue.waiter', 'Waiter', [K.QUEUE_VIEW, K.QUEUE_SEAT, K.TABLES_VIEW]),
      toggle('queue.customer_display', 'Customer Display', [K.QUEUE_VIEW]),
    ],
  },
  {
    key: 'banquet',
    title: 'Banquet',
    toggles: [
      toggle('banquet.booking', 'Booking', [
        K.BANQUET_VIEW,
        K.BANQUET_BOOKING_CREATE,
        K.BANQUET_BOOKING_UPDATE,
        K.BANQUET_BOOKING_CONFIRM,
        K.BANQUET_BOOKING_CANCEL,
        K.BANQUET_BOOKING_COMPLETE,
        K.BANQUET_PAYMENT_CREATE,
        K.BANQUET_EVENT_PLAN_MANAGE,
        K.BANQUET_CHARGE_MANAGE,
        K.BANQUET_PLATE_REQUEST,
      ]),
      toggle('banquet.reports', 'Reports', [K.BANQUET_VIEW, K.REPORTS_VIEW]),
      toggle('banquet.finance', 'Finance', [K.BANQUET_VIEW, K.BANQUET_FINANCE_VIEW, K.BANQUET_PAYMENT_VERIFY]),
      toggle('banquet.discount', 'Discount', [K.BANQUET_VIEW, K.BANQUET_DISCOUNT_APPLY]),
      toggle('banquet.chef_display', 'Chef Display', [K.BANQUET_KDS_VIEW, K.BANQUET_KDS_MANAGE]),
    ],
  },
  {
    key: 'reports',
    title: 'Reports',
    toggles: [
      toggle('reports.queue', 'Queue Reports', [K.REPORTS_VIEW, K.QUEUE_VIEW]),
      toggle('reports.tasks', 'Task Reports', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.eod', 'EOD Reports', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.requests', 'Request Reports'),
      toggle('reports.operational_checklist', 'Operational Checklist', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.kitchen_checklist', 'Kitchen Checklist', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.branch_head_opening', 'Branch Head Opening', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.banquet_opening', 'Banquet Opening', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.bm_checklist', 'BM Checklist', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.kitchen_stock', 'Kitchen Stock', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.biryani_sales', 'Biryani Sales', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.kitchen_balance', 'Kitchen Balance', [K.REPORTS_VIEW, K.TASKS_REPORTS_VIEW]),
      toggle('reports.pos', 'POS Reports', [K.REPORTS_VIEW, K.POS_REPORTS_VIEW]),
      toggle('reports.purchase_orders', 'Purchase Orders (legacy)', [K.REPORTS_VIEW, K.PURCHASE_REPORTS_VIEW]),
    ],
  },
  {
    key: 'pos',
    title: 'POS',
    toggles: [
      toggle('pos.table_view', 'POS Table View'),
      toggle('pos.captain', 'Captain POS'),
      toggle('pos.billing', 'Billing'),
      toggle('pos.central_kds', 'Central Kitchen Display'),
      toggle('pos.department_kds', 'Department KDS'),
      toggle('pos.setup', 'POS Setup (floors, departments)'),
    ],
  },
  {
    key: 'inventory',
    title: 'Inventory & Suppliers',
    toggles: [
      toggle('inventory.inventory', 'Inventory', [K.INVENTORY_VIEW, K.INVENTORY_TRANSFER]),
      toggle('inventory.suppliers_payments', 'Suppliers & Payments', [K.INVENTORY_VIEW]),
      toggle('inventory.suppliers_setup', 'Suppliers Setup', [K.INVENTORY_VIEW, K.INVENTORY_SUPPLIERS_MANAGE]),
      toggle('inventory.raw_materials', 'Raw Materials', [K.INVENTORY_VIEW]),
      toggle('inventory.purchase', 'Purchase', [K.INVENTORY_VIEW, K.INVENTORY_PURCHASE_CREATE]),
      toggle('inventory.kitchen_head', 'Kitchen Head (financials)'),
      toggle('inventory.manual_purchase', 'Manual purchase (no prices)', [K.INVENTORY_VIEW, K.INVENTORY_PURCHASE_CREATE]),
      toggle('inventory.approve_requests', 'Approve Stock Requests'),
      toggle('inventory.reports', 'Inventory Reports', [K.INVENTORY_VIEW, K.REPORTS_VIEW, K.PURCHASE_REPORTS_VIEW]),
      toggle('inventory.record_payments', 'Record Payments', [K.INVENTORY_VIEW, K.INVENTORY_PURCHASE_CREATE]),
      toggle('inventory.switch_supplier', 'Switch Supplier'),
      toggle('inventory.asset_tracking', 'Asset Tracking'),
    ],
  },
  {
    key: 'finance',
    title: 'Finance',
    toggles: [
      toggle('finance.petty_cash', 'Finance (petty cash & expenses)'),
    ],
  },
];

/** The daily forms, in the reference order. `key` is the checklist's key. */
export const ROUTINES: readonly { key: string; label: string }[] = [
  { key: 'eod-report', label: 'EOD Reports' },
  { key: 'operational-checklist', label: 'Operational Checklist' },
  { key: 'kitchen-checklist', label: 'Kitchen Checklist' },
  { key: 'opening-checklist', label: 'Branch Head Opening' },
  { key: 'banquet-opening', label: 'Banquet Opening' },
  { key: 'branch-manager-checklist', label: 'BM Checklist' },
  { key: 'kitchen-balance', label: 'Kitchen Balance' },
  { key: 'biryani-sales', label: 'Biryani Sales' },
  { key: 'kitchen-stock-request', label: 'Kitchen Stock' },
  { key: 'kitchen-wastage', label: 'Kitchen Wastage' },
  { key: 'corporate-branch-visit', label: 'Corporate Branch Visit Report' },
  { key: 'activity-calendar', label: 'Activity Calendar' },
];

/**
 * What a level on ANY daily form grants. Tasks carry no per-form permission
 * yet, so the levels are branch-wide: Staff fills forms in, Manager also sets
 * them up and reads their reports. The per-form choice is kept with the user.
 */
const ROUTINE_GRANTS: Record<RoutineLevel, readonly PermissionKey[]> = {
  STAFF: [K.TASKS_VIEW, K.TASKS_UPDATE, K.TASKS_START, K.TASKS_COMPLETE],
  MANAGER: [
    K.TASKS_VIEW,
    K.TASKS_UPDATE,
    K.TASKS_START,
    K.TASKS_COMPLETE,
    K.TASKS_CREATE,
    K.TASKS_ASSIGN,
    K.TASKS_ROUTINE_MANAGE,
    K.TASKS_CHECKLIST_MANAGE,
    K.TASKS_REPORTS_VIEW,
  ],
};

/** Tasks Module: Receive works tasks given to you; Both also gives them out. */
const TASK_GRANTS: Record<TaskMode, readonly PermissionKey[]> = {
  OFF: [],
  RECEIVE: [K.TASKS_VIEW_OWN, K.TASKS_UPDATE, K.TASKS_START, K.TASKS_COMPLETE],
  BOTH: [
    K.TASKS_VIEW,
    K.TASKS_VIEW_OWN,
    K.TASKS_UPDATE,
    K.TASKS_START,
    K.TASKS_COMPLETE,
    K.TASKS_CREATE,
    K.TASKS_ASSIGN,
    K.TASKS_CANCEL,
  ],
};

/**
 * What the user type grants beyond the toggles: the administration the form
 * has no switch for. Each type includes the one below it.
 */
const STAFF_BASE: readonly PermissionKey[] = [K.DASHBOARD_VIEW, K.CUSTOMERS_VIEW];
const MANAGER_BASE: readonly PermissionKey[] = [
  ...STAFF_BASE,
  K.CUSTOMERS_CREATE,
  K.CUSTOMERS_UPDATE,
  K.TABLES_VIEW,
  K.TABLES_CREATE,
  K.TABLES_UPDATE,
  K.DISPLAY_DEVICES_VIEW,
  K.DISPLAY_DEVICES_CREATE,
  K.DISPLAY_DEVICES_REVOKE,
  K.BRANCHES_VIEW,
  K.REPORTS_EXPORT,
];
const ADMIN_BASE: readonly PermissionKey[] = [
  ...MANAGER_BASE,
  K.USERS_VIEW,
  K.USERS_CREATE,
  K.USERS_UPDATE,
  K.USERS_DISABLE,
  K.ROLES_VIEW,
  K.ROLES_CREATE,
  K.ROLES_UPDATE,
  K.MEMBERSHIPS_VIEW,
  K.MEMBERSHIPS_CREATE,
  K.MEMBERSHIPS_UPDATE,
  K.BRANCHES_CREATE,
  K.BRANCHES_UPDATE,
  K.BRANCHES_DISABLE,
  K.COMPANIES_VIEW,
  K.COMPANIES_UPDATE,
  K.AUDIT_LOGS_VIEW,
  K.BANQUET_HALL_MANAGE,
  K.BANQUET_PACKAGE_MANAGE,
  K.BANQUET_DISCOUNT_ADMIN,
  K.BANQUET_BOOKING_EDIT_PAST,
  K.BANQUET_BOOKING_EDIT_LOCKED,
  K.BANQUET_BOOKING_DELETE,
  K.TASKS_ROUTINE_MANAGE,
  K.TASKS_CHECKLIST_MANAGE,
];
const TYPE_GRANTS: Record<UserTypeKey, readonly PermissionKey[]> = {
  STAFF: STAFF_BASE,
  MANAGER: MANAGER_BASE,
  ADMIN: ADMIN_BASE,
};

const ALL_TOGGLES = ACCESS_SECTIONS.flatMap((s) => s.toggles);
const TOGGLE_BY_KEY = new Map(ALL_TOGGLES.map((t) => [t.key, t]));
const ROUTINE_KEYS = new Set(ROUTINES.map((r) => r.key));

const allRoutines = (level: RoutineLevel) =>
  Object.fromEntries(ROUTINES.map((r) => [r.key, level])) as Record<string, RoutineLevel>;
const togglesOf = (...sections: string[]) =>
  ACCESS_SECTIONS.filter((s) => sections.includes(s.key)).flatMap((s) => s.toggles.map((t) => t.key));

/** "Quick Set User Type": the selection each type starts from. */
export const ACCESS_PRESETS: Record<UserTypeKey, AccessSelection> = {
  ADMIN: { toggles: ALL_TOGGLES.map((t) => t.key), routines: allRoutines('MANAGER'), tasks: 'BOTH' },
  MANAGER: {
    toggles: [
      ...togglesOf('queue', 'reports', 'finance'),
      'banquet.booking',
      'banquet.reports',
      'banquet.finance',
      'banquet.chef_display',
      'inventory.inventory',
      'inventory.suppliers_payments',
      'inventory.raw_materials',
      'inventory.purchase',
      'inventory.manual_purchase',
      'inventory.reports',
      'inventory.record_payments',
    ],
    routines: allRoutines('MANAGER'),
    tasks: 'BOTH',
  },
  STAFF: {
    toggles: ['queue.podium', 'queue.register', 'queue.waiter', 'queue.customer_display'],
    routines: allRoutines('STAFF'),
    tasks: 'RECEIVE',
  },
};

/** Drops anything the catalogue does not know, so stored access stays clean. */
export function normalizeSelection(selection: AccessSelection): AccessSelection {
  const toggles = [...new Set(selection.toggles)].filter((k) => TOGGLE_BY_KEY.has(k));
  const routines: Record<string, RoutineLevel> = {};
  for (const [key, level] of Object.entries(selection.routines ?? {})) {
    if (ROUTINE_KEYS.has(key) && (ROUTINE_LEVELS as readonly string[]).includes(level)) routines[key] = level;
  }
  const tasks = (TASK_MODES as readonly string[]).includes(selection.tasks) ? selection.tasks : 'OFF';
  return { toggles, routines, tasks };
}

/** Every permission key a user of this type, with this selection, holds. */
export function permissionsFor(type: UserTypeKey, selection: AccessSelection): PermissionKey[] {
  const keys = new Set<PermissionKey>(TYPE_GRANTS[type]);
  for (const key of selection.toggles) for (const p of TOGGLE_BY_KEY.get(key)?.permissions ?? []) keys.add(p);
  for (const level of Object.values(selection.routines)) for (const p of ROUTINE_GRANTS[level]) keys.add(p);
  for (const p of TASK_GRANTS[selection.tasks]) keys.add(p);
  return [...keys].sort();
}

/**
 * For someone given access before User Management existed (through shared
 * roles), the form starts from what they can actually do: a toggle is on when
 * every key it grants is held. Toggles for features not built yet start off.
 */
export function selectionFromPermissions(held: ReadonlySet<string>): AccessSelection {
  const holdsAll = (keys: readonly string[]) => keys.length > 0 && keys.every((k) => held.has(k));
  const level: RoutineLevel | null = holdsAll(ROUTINE_GRANTS.MANAGER)
    ? 'MANAGER'
    : holdsAll(ROUTINE_GRANTS.STAFF)
      ? 'STAFF'
      : null;
  return {
    toggles: ALL_TOGGLES.filter((t) => holdsAll(t.permissions)).map((t) => t.key),
    routines: level ? allRoutines(level) : {},
    tasks: holdsAll(TASK_GRANTS.BOTH) ? 'BOTH' : holdsAll(TASK_GRANTS.RECEIVE) ? 'RECEIVE' : 'OFF',
  };
}

/** The type someone given access before User Management most resembles. */
export function typeFromPermissions(held: ReadonlySet<string>): UserTypeKey {
  if (held.has(K.USERS_UPDATE)) return 'ADMIN';
  if (held.has(K.TASKS_VIEW) || held.has(K.REPORTS_VIEW) || held.has(K.BANQUET_BOOKING_CONFIRM)) return 'MANAGER';
  return 'STAFF';
}

/** The catalogue the form is drawn from. */
export function accessCatalogue() {
  return {
    sections: ACCESS_SECTIONS.map((s) => ({
      key: s.key,
      title: s.title,
      toggles: s.toggles.map((t) => ({ key: t.key, label: t.label, available: t.permissions.length > 0 })),
    })),
    routines: ROUTINES,
    presets: ACCESS_PRESETS,
  };
}
