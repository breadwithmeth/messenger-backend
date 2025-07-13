import prisma from '../config/prisma';

export async function createUser(data: {
  organizationId: number;
  email: string;
  passwordHash: string;
  name?: string;
  role?: string;
}) {
  return prisma.user.create({ data });
}

export async function findUserByEmail(email: string) {
  return prisma.user.findUnique({
    where: { email },
  });
}

export async function getUserById(id: number) {
  return prisma.user.findUnique({
    where: { id },
  });
}

export async function listUsersByOrganization(organizationId: number) {
  return prisma.user.findMany({
    where: { organizationId },
  });
}

export async function updateUser(id: number, data: Partial<{
  email: string;
  passwordHash: string;
  name: string;
  role: string;
}>) {
  return prisma.user.update({
    where: { id },
    data,
  });
}

export async function deleteUser(id: number) {
  return prisma.user.delete({
    where: { id },
  });
}
