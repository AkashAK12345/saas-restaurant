/**
 * SAMCO — System Permission Seed
 *
 * Idempotently upserts all system-defined permissions into the database.
 * Clients cannot create arbitrary permissions — this script is the only way
 * new system permissions are introduced.
 *
 * How to run (from the packages/database directory):
 *
 *   npx prisma db seed
 *
 * Or from the monorepo root:
 *
 *   npm run db:seed --workspace packages/database
 *
 * The DATABASE_URL environment variable must be set (from .env at monorepo root).
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const SYSTEM_PERMISSIONS: Array<{ name: string; module: string; description: string }> = [
  // Company management
  { name: 'companies.view', module: 'companies', description: 'View company details' },
  { name: 'companies.update', module: 'companies', description: 'Update company details and settings' },
  { name: 'companies.disable', module: 'companies', description: 'Disable or suspend a company' },

  // Branch management
  { name: 'branches.view', module: 'branches', description: 'View branches in company' },
  { name: 'branches.create', module: 'branches', description: 'Create new branches in company' },
  { name: 'branches.update', module: 'branches', description: 'Update branch details' },
  { name: 'branches.disable', module: 'branches', description: 'Disable or re-enable a branch' },

  // Membership management
  { name: 'memberships.view', module: 'memberships', description: 'View company member list' },
  { name: 'memberships.create', module: 'memberships', description: 'Add users to company' },
  { name: 'memberships.update', module: 'memberships', description: 'Update membership status' },

  // User management
  { name: 'users.view', module: 'users', description: 'View users in company' },
  { name: 'users.create', module: 'users', description: 'Create new user accounts' },
  { name: 'users.update', module: 'users', description: 'Update user details and branch role assignments' },
  { name: 'users.disable', module: 'users', description: 'Disable or re-enable user accounts' },

  // Role management
  { name: 'roles.view', module: 'roles', description: 'View roles in company' },
  { name: 'roles.create', module: 'roles', description: 'Create roles in company' },
  { name: 'roles.update', module: 'roles', description: 'Update roles and assign permissions to roles' },

  // POS
  { name: 'pos.order.create', module: 'pos', description: 'Create POS orders' },
  { name: 'pos.order.update', module: 'pos', description: 'Update POS orders' },
  { name: 'pos.order.cancel', module: 'pos', description: 'Cancel POS orders' },
  { name: 'pos.payment.create', module: 'pos', description: 'Process payments' },
  { name: 'pos.refund', module: 'pos', description: 'Issue refunds' },

  // Inventory
  { name: 'inventory.stock.view', module: 'inventory', description: 'View stock levels' },
  { name: 'inventory.stock.adjust', module: 'inventory', description: 'Adjust stock levels' },
  { name: 'inventory.transfer', module: 'inventory', description: 'Transfer stock between locations' },

  // Finance
  { name: 'finance.expense.create', module: 'finance', description: 'Create petty cash expenses' },
  { name: 'finance.expense.approve', module: 'finance', description: 'Approve expenses' },

  // Reports
  { name: 'reports.view', module: 'reports', description: 'View reports' },

  // Audit Logs
  { name: 'audit_logs.view', module: 'audit_logs', description: 'View company audit logs' },
];

async function main() {
  console.log(`Seeding ${SYSTEM_PERMISSIONS.length} system permissions...`);

  let created = 0;
  let updated = 0;

  for (const perm of SYSTEM_PERMISSIONS) {
    const result = await prisma.permission.upsert({
      where: { name: perm.name },
      update: { module: perm.module, description: perm.description },
      create: perm,
    });
    // Prisma upsert doesn't tell us which path was taken — track by created_at vs updated_at
    if (result.created_at.getTime() === result.updated_at.getTime()) {
      created++;
    } else {
      updated++;
    }
  }

  console.log(`Done: ${created} created, ${updated} updated.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

