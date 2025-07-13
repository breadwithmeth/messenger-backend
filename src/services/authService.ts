import prisma from '../config/prisma';

export async function findUserByEmail(email: string) {
  return await prisma.user.findUnique({ where: { email } });
}
