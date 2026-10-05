/**
 * SAMCO — set up the owner account (central control).
 *
 * Creates the account if it does not exist, marks it as THE owner, and makes
 * it an Admin with every permission at every branch of every active company.
 * Safe to run again: it brings the owner's access up to date and leaves the
 * password alone unless OWNER_PASSWORD is given.
 *
 * The credentials come from the environment, never from this file:
 *
 *   OWNER_EMAIL=you@example.com OWNER_PASSWORD='...' npx tsx owner.ts
 *
 * Run from packages/database with DATABASE_URL set (as for the seed).
 * Only one owner may exist; the script refuses to make a second.
 */
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { syncOwnerAccess } from '../../apps/api/src/modules/users/owner-access.js';
import { PASSWORD_POLICY } from '../../apps/api/src/common/password-policy.js';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.OWNER_EMAIL?.trim().toLowerCase();
  const password = process.env.OWNER_PASSWORD;
  if (!email) throw new Error('Set OWNER_EMAIL');
  if (password !== undefined && (password.length < PASSWORD_POLICY.MIN_LENGTH || password.length > PASSWORD_POLICY.MAX_LENGTH)) {
    throw new Error(`OWNER_PASSWORD must be ${PASSWORD_POLICY.MIN_LENGTH}-${PASSWORD_POLICY.MAX_LENGTH} characters`);
  }

  const other = await prisma.user.findFirst({ where: { is_owner: true, NOT: { email } }, select: { email: true } });
  if (other) throw new Error(`${other.email} is already the owner; only one owner is allowed`);

  let user = await prisma.user.findUnique({ where: { email } });
  if (!user && password === undefined) throw new Error('The account does not exist yet: set OWNER_PASSWORD to create it');

  const password_hash = password !== undefined ? await bcrypt.hash(password, 10) : undefined;
  user = user
    ? await prisma.user.update({
        where: { id: user.id },
        // Owner, platform admin (may create companies), able to sign in.
        data: { is_owner: true, is_superadmin: true, status: 'ACTIVE', ...(password_hash ? { password_hash } : {}) },
      })
    : await prisma.user.create({
        data: { email, password_hash: password_hash!, is_owner: true, is_superadmin: true },
      });

  await prisma.$transaction((tx) => syncOwnerAccess(tx, user!.id), { timeout: 60_000 });

  const memberships = await prisma.companyMembership.count({ where: { user_id: user.id, status: 'ACTIVE' } });
  const branches = await prisma.userBranchRole.count({ where: { user_id: user.id } });
  console.log(`Owner ${email}: admin in ${memberships} company(ies), ${branches} branch(es)${password_hash ? '; password set' : ''}.`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
