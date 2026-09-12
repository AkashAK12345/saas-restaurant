import bcrypt from 'bcrypt';
import { BranchStatus, CompanyStatus, MembershipStatus, PrismaClient } from '@prisma/client';
import { assertE2eDatabaseUrl, resetBrowserDatabase } from './support/database';
import { SamcoApi } from './support/api';
import {
  BOOKING,
  BRANCH,
  CHECKLIST,
  COMPANY_A,
  COMPANY_B,
  CUSTOMERS,
  HALL,
  PACKAGE,
  ROLE_PERMISSIONS,
  ROUTINE,
  TABLES,
  TASK_TITLE,
  TIMEZONE,
  USERS,
  branchToday,
  testPassword,
  type DeviceCredentials,
  type Fixture,
  type Role,
} from './support/data';

/**
 * Builds the run's fixtures from nothing.
 *
 * Only what has no application path is written through Prisma — companies,
 * branches, roles and the staff accounts (the API's own e2e suites do the
 * same). Everything else goes through the real API as the manager: tables,
 * customers, queue tokens, the banquet booking, the task and — crucially —
 * the display devices, so their credentials are minted the way a real screen's
 * would be.
 *
 * Results reach the specs through the environment (never a file): ids in
 * SAMCO_E2E_FIXTURE, device credentials in SAMCO_E2E_DEVICES.
 */
export default async function globalSetup(): Promise<void> {
  const url = assertE2eDatabaseUrl(process.env.SAMCO_E2E_DATABASE_URL);
  const password = testPassword();

  const prisma = new PrismaClient({ datasourceUrl: url });
  let ids: { companyA: string; companyB: string; bengaluru: string; pallavaram: string; chennai: string };
  try {
    await resetBrowserDatabase(prisma, url);

    const permissions = await prisma.permission.findMany({ select: { id: true, name: true } });
    if (permissions.length === 0) {
      throw new Error('[browser-e2e] The permission catalogue is empty; `prisma db seed` did not run.');
    }
    const byName = new Map(permissions.map((p) => [p.name, p.id]));
    const grant = (names: readonly string[]) =>
      names.map((n) => {
        const id = byName.get(n);
        if (!id) throw new Error(`[browser-e2e] Permission "${n}" is not in the catalogue.`);
        return id;
      });

    const companyA = await prisma.company.create({ data: { name: COMPANY_A, status: CompanyStatus.ACTIVE } });
    const companyB = await prisma.company.create({ data: { name: COMPANY_B, status: CompanyStatus.ACTIVE } });
    const branch = (companyId: string, name: string) =>
      prisma.branch.create({ data: { company_id: companyId, name, timezone: TIMEZONE, status: BranchStatus.ACTIVE } });
    const bengaluru = await branch(companyA.id, BRANCH.bengaluru);
    const pallavaram = await branch(companyA.id, BRANCH.pallavaram);
    const chennai = await branch(companyB.id, BRANCH.chennai);

    const roleIds = {} as Record<Role, string>;
    for (const role of Object.keys(USERS) as Role[]) {
      const created = await prisma.role.create({ data: { company_id: companyA.id, name: USERS[role].roleName } });
      roleIds[role] = created.id;
      const permissionIds = role === 'manager' ? permissions.map((p) => p.id) : grant(ROLE_PERMISSIONS[role]);
      if (permissionIds.length > 0) {
        await prisma.rolePermission.createMany({
          data: permissionIds.map((permission_id) => ({ role_id: created.id, permission_id })),
        });
      }
    }

    const hash = await bcrypt.hash(password, 10);
    for (const role of Object.keys(USERS) as Role[]) {
      const u = USERS[role];
      const user = await prisma.user.create({
        data: { email: u.email, password_hash: hash, first_name: u.firstName, last_name: u.lastName },
      });
      await prisma.companyMembership.create({
        data: { user_id: user.id, company_id: companyA.id, status: MembershipStatus.ACTIVE },
      });
      const branches = role === 'manager' ? [bengaluru.id, pallavaram.id] : [bengaluru.id];
      await prisma.userBranchRole.createMany({
        data: branches.map((branch_id) => ({ user_id: user.id, branch_id, role_id: roleIds[role] })),
      });
    }

    ids = {
      companyA: companyA.id,
      companyB: companyB.id,
      bengaluru: bengaluru.id,
      pallavaram: pallavaram.id,
      chennai: chennai.id,
    };
  } finally {
    await prisma.$disconnect();
  }

  // From here on, the application's own API. Signing in with this run's
  // password also proves the API is serving THIS database: the account exists
  // nowhere else.
  const manager = await SamcoApi.login(USERS.manager.email, password, ids.companyA);
  try {
    const blr = ids.bengaluru;
    const pal = ids.pallavaram;

    const tables: Record<string, string> = {};
    for (const t of TABLES) {
      const created = await manager.send<{ id: string }>('POST', 'tables', blr, t);
      tables[t.label] = created.id;
    }
    await manager.send('POST', 'tables', pal, { label: 'P1', capacity: 4 });

    const priya = await manager.send<{ id: string }>('POST', 'customers', blr, {
      name: CUSTOMERS.priya,
      phone: '+919800000001',
    });
    const arun = await manager.send<{ id: string }>('POST', 'customers', blr, { name: CUSTOMERS.arun });

    // Bengaluru: three parties waiting, one of them a named customer the
    // screens must never reveal. Pallavaram: a different number waiting, so a
    // screen showing the wrong branch is detectable.
    await manager.register(blr, { adults: 2 });
    await manager.register(blr, { adults: 4, customer_id: priya.id });
    await manager.register(blr, { adults: 2, kids: 1 });
    for (let i = 0; i < 5; i++) await manager.register(pal, { adults: 2 });

    const hall = await manager.send<{ id: string }>('POST', 'banquet/halls', blr, HALL);
    const pkg = await manager.send<{ id: string }>('POST', 'banquet/packages', blr, {
      name: PACKAGE.name,
      price_per_guest_minor: PACKAGE.pricePerGuestMinor,
      currency: PACKAGE.currency,
      items: PACKAGE.dishes.map((name) => ({ name })),
    });
    // Tonight in the branch timezone, so the kitchen board (today only) shows it.
    const today = branchToday();
    const booking = await manager.send<{ id: string }>('POST', 'banquet/bookings', blr, {
      customer_id: priya.id,
      hall_id: hall.id,
      package_id: pkg.id,
      starts_at: `${today}T20:00:00+05:30`,
      ends_at: `${today}T23:00:00+05:30`,
      guest_count: BOOKING.guests,
    });
    await manager.send('POST', `banquet/bookings/${booking.id}/confirm`, blr, {});
    await manager.send('PUT', `banquet/bookings/${booking.id}/event-plan`, blr, {
      kitchen_notes: BOOKING.kitchenNotes,
    });

    const checklist = await manager.send<{ id: string }>('POST', 'checklists', blr, CHECKLIST);
    const task = await manager.send<{ id: string }>('POST', 'tasks', blr, {
      title: TASK_TITLE,
      priority: 'HIGH',
      checklist_template_id: checklist.id,
    });
    await manager.send('POST', 'routines', blr, { name: ROUTINE.name, frequency: 'DAILY', time_of_day: ROUTINE.time });

    const customer = await manager.createDevice(blr, 'QUEUE_CUSTOMER', 'E2E queue customer screen');
    const admin = await manager.createDevice(blr, 'QUEUE_ADMIN', 'E2E queue admin screen');
    const chef = await manager.createDevice(blr, 'BANQUET_CHEF', 'E2E kitchen screen');
    const revoked = await manager.createDevice(blr, 'QUEUE_CUSTOMER', 'E2E revoked screen');
    await manager.revokeDevice(blr, revoked.id);

    const fixture: Fixture = {
      companyA: ids.companyA,
      companyB: ids.companyB,
      branches: { bengaluru: blr, pallavaram: pal, chennai: ids.chennai },
      tables,
      customers: { priya: priya.id, arun: arun.id },
      bookingId: booking.id,
      taskId: task.id,
      serviceDate: today,
    };
    const credentials: DeviceCredentials = {
      customer: customer.credential,
      admin: admin.credential,
      chef: chef.credential,
      revoked: revoked.credential,
    };
    process.env.SAMCO_E2E_FIXTURE = JSON.stringify(fixture);
    process.env.SAMCO_E2E_DEVICES = JSON.stringify(credentials);
  } finally {
    await manager.dispose();
  }
}
