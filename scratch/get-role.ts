import { PrismaClient } from '@prisma/client';
const prisma = new PrismaClient();
async function main() {
  const role = await prisma.role.findFirst({ where: { name: 'Beta Manager' }, include: { company: true }});
  if (role) {
    console.log(`Beta Manager Role ID: ${role.id}, Company ID: ${role.company_id}`);
  }
}
main().catch(console.error).finally(() => prisma.$disconnect());
