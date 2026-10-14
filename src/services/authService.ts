import prisma from '../config/prisma.js';

export async function findUserByEmail(email: string) {
  return await prisma.user.findUnique({ where: { email } });
}
