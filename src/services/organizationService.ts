import prisma from '../config/prisma';

export async function createOrganization(name: string) {
  return prisma.organization.create({
    data: { name },
  });
}

export async function listOrganizations() {
  return prisma.organization.findMany();
}

export async function getOrganizationById(id: number) {
  return prisma.organization.findUnique({
    where: { id },
  });
}

export async function updateOrganization(id: number, data: { name?: string }) {
  return prisma.organization.update({
    where: { id },
    data,
  });
}

export async function deleteOrganization(id: number) {
  return prisma.organization.delete({
    where: { id },
  });
}
