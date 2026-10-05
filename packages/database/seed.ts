/**
 * SAMCO — System Permission Seed
 *
 * Idempotently upserts all system-defined permissions into the database.
 * Clients cannot create arbitrary permissions — this script is the only way
 * new system permissions are introduced.
 *
 * SINGLE SOURCE OF TRUTH:
 * The permission list is NOT declared here. It is imported from
 * `apps/api/src/common/authorization/permission-keys.ts`, which is the one
 * authoritative definition used by both the application (PermissionGuard,
 * @RequireCompanyPermission / @RequireBranchPermission) and this seed.
 *
 * This script is dev/ops tooling executed by `tsx`, not library code, so the
 * relative import into apps/api is deliberate: it keeps a single list rather
 * than a second copy that can silently drift out of sync.
 *
 * How to run (from the packages/database directory):
 *
 *   npx prisma db seed
 *
 * The DATABASE_URL environment variable must be set (from .env at monorepo root).
 */
import { PrismaClient } from '@prisma/client';
import { SYSTEM_PERMISSIONS } from '../../apps/api/src/common/authorization/permission-keys.js';
import { findOwnerId, syncOwnerAccess } from '../../apps/api/src/modules/users/owner-access.js';

const prisma = new PrismaClient();

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

  // The owner holds every permission, including any just added.
  const ownerId = await findOwnerId(prisma);
  if (ownerId) {
    await prisma.$transaction((tx) => syncOwnerAccess(tx, ownerId), { timeout: 60_000 });
    console.log('Owner access brought up to date.');
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
