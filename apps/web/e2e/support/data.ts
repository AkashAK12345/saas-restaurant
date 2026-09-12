/**
 * Deterministic fixture definitions shared by global setup and the specs.
 *
 * Nothing here is secret. The run's password and the display credentials are
 * generated at run time and travel only through the environment of the test
 * processes (see playwright.config.ts and global-setup.ts).
 */
export const COMPANY_A = 'Spice Route';
export const COMPANY_B = 'Harbour Grill';
export const TIMEZONE = 'Asia/Kolkata';
export const BRANCH = { bengaluru: 'Bengaluru', pallavaram: 'Pallavaram', chennai: 'Chennai' } as const;

export type Role = 'manager' | 'chef' | 'worker' | 'noperm';

export const USERS: Record<Role, { email: string; firstName: string; lastName: string; roleName: string }> = {
  manager: { email: 'manager@samco.test', firstName: 'Meera', lastName: 'Nair', roleName: 'Manager' },
  chef: { email: 'chef@samco.test', firstName: 'Kabir', lastName: 'Das', roleName: 'Chef' },
  worker: { email: 'worker@samco.test', firstName: 'Arjun', lastName: 'Rao', roleName: 'Worker' },
  noperm: { email: 'noperm@samco.test', firstName: 'Nila', lastName: 'Iyer', roleName: 'No access' },
};

/**
 * Branch grants at Bengaluru, as in the manual acceptance fixture. The manager
 * holds every permission at Bengaluru and Pallavaram. These are the CURRENT
 * roles under test — never widen them to make a test pass.
 */
export const ROLE_PERMISSIONS: Record<Exclude<Role, 'manager'>, readonly string[]> = {
  chef: ['banquet.kds.view', 'banquet.kds.manage'],
  worker: ['tasks.view', 'tasks.start', 'tasks.update', 'tasks.complete'],
  noperm: [],
};

export const CUSTOMERS = { priya: 'Priya Sharma', arun: 'Arun Menon' } as const;
export const TABLES = [
  { label: 'T1', capacity: 4 },
  { label: 'T2', capacity: 2 },
  { label: 'T3', capacity: 6 },
] as const;
export const HALL = { name: 'Terrace', capacity: 80 } as const;
export const PACKAGE = {
  name: 'Silver',
  pricePerGuestMinor: 85_000,
  currency: 'INR',
  dishes: ['Paneer tikka', 'Dal makhani', 'Gulab jamun'],
} as const;
export const BOOKING = { guests: 30, kitchenNotes: 'No onions for the head table' } as const;
export const CHECKLIST = {
  name: 'Opening checks',
  items: [
    { label: 'Unlock doors', is_required: true },
    { label: 'Check fridge temps', is_required: true },
    { label: 'Wipe menus', is_required: false },
  ],
} as const;
export const TASK_TITLE = 'Open the restaurant';
export const ROUTINE = { name: 'Close the kitchen', time: '23:30' } as const;

export interface Fixture {
  companyA: string;
  companyB: string;
  branches: { bengaluru: string; pallavaram: string; chennai: string };
  /** Bengaluru table label → id. */
  tables: Record<string, string>;
  customers: { priya: string; arun: string };
  bookingId: string;
  taskId: string;
  /** Bengaluru's service date, YYYY-MM-DD in the branch timezone. */
  serviceDate: string;
}

export interface DeviceCredentials {
  customer: string;
  admin: string;
  chef: string;
  revoked: string;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[browser-e2e] ${name} is not set — run the suite with \`npm run test:browser\`.`);
  return value;
}

export const testPassword = (): string => required('SAMCO_E2E_PASSWORD');
export const apiOrigin = (): string => required('SAMCO_E2E_API_ORIGIN');
export const webOrigin = (): string => required('SAMCO_E2E_WEB_ORIGIN');
export const loadFixture = (): Fixture => JSON.parse(required('SAMCO_E2E_FIXTURE')) as Fixture;
export const loadCredentials = (): DeviceCredentials => JSON.parse(required('SAMCO_E2E_DEVICES')) as DeviceCredentials;

/** Today's date in the branch timezone, YYYY-MM-DD. */
export function branchToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
