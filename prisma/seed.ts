import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  const hashed = await bcrypt.hash('123456', 10);

  let organization = await prisma.organization.findFirst({
    where: { name: 'MyOrg' }
  });

  if (!organization) {
    organization = await prisma.organization.create({
      data: { name: 'MyOrg' }
    });
  }

  const user = await prisma.user.create({
    data: {
      email: 'admin@example.com',
      passwordHash: hashed,
      organizationId: organization.id
    }
  });

  console.log('✅ User created:', user);
}

main().catch(console.error).finally(() => prisma.$disconnect());
