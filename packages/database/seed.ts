import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding foundational system permissions...');

  const systemPermissions = [
    { name: 'pos.order.create', module: 'pos', description: 'Create POS orders' },
    { name: 'pos.order.cancel', module: 'pos', description: 'Cancel POS orders' },
    { name: 'pos.payment.create', module: 'pos', description: 'Process payments' },
    { name: 'pos.refund', module: 'pos', description: 'Issue refunds' },
    { name: 'inventory.stock.view', module: 'inventory', description: 'View stock levels' },
    { name: 'inventory.stock.adjust', module: 'inventory', description: 'Adjust stock levels' },
    { name: 'inventory.transfer', module: 'inventory', description: 'Transfer stock between locations' },
    { name: 'finance.expense.create', module: 'finance', description: 'Create petty cash expenses' },
    { name: 'finance.expense.approve', module: 'finance', description: 'Approve expenses' },
  ];

  for (const perm of systemPermissions) {
    await prisma.permission.upsert({
      where: { name: perm.name },
      update: {},
      create: perm,
    });
  }

  console.log('System permissions seeded successfully.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
