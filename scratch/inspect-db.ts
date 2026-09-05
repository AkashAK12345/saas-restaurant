import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('--- Inspecting Database State ---');

  const users = await prisma.user.findMany({ select: { id: true, email: true } });
  console.log('\nUsers:');
  console.table(users);

  const companies = await prisma.company.findMany({ select: { id: true, name: true, status: true } });
  console.log('\nCompanies:');
  console.table(companies);

  const branches = await prisma.branch.findMany({ select: { id: true, name: true, company_id: true } });
  console.log('\nBranches:');
  console.table(branches);
  
  const memberships = await prisma.companyMembership.findMany({
    include: { user: true, company: true }
  });
  console.log('\nMemberships:');
  memberships.forEach(m => console.log(`${m.user.email} in ${m.company.name} [Status: ${m.status}]`));

  const ubrs = await prisma.userBranchRole.findMany({
    include: { user: true, branch: true, role: { include: { permissions: { include: { permission: true } } } } }
  });
  console.log('\nUserBranchRoles:');
  ubrs.forEach(u => {
    const perms = u.role.permissions.map(p => p.permission.name).join(', ');
    console.log(`${u.user.email} at ${u.branch.name} has role ${u.role.name} [Perms: ${perms}]`);
  });
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
