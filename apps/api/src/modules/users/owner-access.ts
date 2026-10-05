import { BranchStatus, CompanyStatus, MembershipStatus, Prisma, type PrismaClient } from '@samco/database';
import { ACCESS_PRESETS } from './user-access.js';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * The owner account: central control of every company.
 *
 * In each ACTIVE company the owner is an active Admin member at every branch
 * (Corporate), holding a personal role with EVERY permission the system
 * defines — so the "grant only what you hold" rule never stops them, and
 * they can add users and give them any access.
 *
 * Idempotent: run it again after adding permissions, companies or branches
 * and the owner's access is brought up to date. Called by the owner set-up
 * script, the permission seed, and company creation.
 */
export async function syncOwnerAccess(db: Db, ownerId: string, onlyCompanyId?: string): Promise<void> {
  const [companies, permissions] = await Promise.all([
    db.company.findMany({
      where: { status: CompanyStatus.ACTIVE, ...(onlyCompanyId ? { id: onlyCompanyId } : {}) },
      select: { id: true, branches: { where: { status: BranchStatus.ACTIVE }, select: { id: true } } },
    }),
    db.permission.findMany({ select: { id: true } }),
  ]);

  for (const company of companies) {
    await db.companyMembership.upsert({
      where: { user_id_company_id: { user_id: ownerId, company_id: company.id } },
      create: {
        user_id: ownerId,
        company_id: company.id,
        status: MembershipStatus.ACTIVE,
        user_type: 'ADMIN',
        is_corporate: true,
        access: ACCESS_PRESETS.ADMIN as unknown as Prisma.InputJsonValue,
      },
      update: {
        status: MembershipStatus.ACTIVE,
        user_type: 'ADMIN',
        is_corporate: true,
        home_branch_id: null,
        access: ACCESS_PRESETS.ADMIN as unknown as Prisma.InputJsonValue,
      },
    });

    const role =
      (await db.role.findUnique({
        where: { company_id_personal_user_id: { company_id: company.id, personal_user_id: ownerId } },
      })) ??
      (await db.role.create({
        data: {
          company_id: company.id,
          personal_user_id: ownerId,
          name: `personal:${ownerId}`,
          description: 'Owner — every permission',
        },
      }));
    await db.rolePermission.createMany({
      data: permissions.map((p) => ({ role_id: role.id, permission_id: p.id })),
      skipDuplicates: true,
    });

    // Every active branch, and nothing but the personal role.
    await db.userBranchRole.deleteMany({
      where: { user_id: ownerId, branch: { company_id: company.id }, role_id: { not: role.id } },
    });
    await db.userBranchRole.createMany({
      data: company.branches.map((b) => ({ user_id: ownerId, branch_id: b.id, role_id: role.id })),
      skipDuplicates: true,
    });
  }
}

/** The owner's id, if one has been set up. */
export async function findOwnerId(db: Db): Promise<string | null> {
  const owner = await db.user.findFirst({ where: { is_owner: true }, select: { id: true } });
  return owner?.id ?? null;
}
