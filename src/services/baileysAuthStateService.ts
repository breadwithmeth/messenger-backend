import prisma from '../config/prisma';

export async function getBaileysAuthState(organizationId: number, phoneJid: string, key: string) {
  return prisma.baileysAuthState.findUnique({
    where: {
      organizationId_phoneJid_key: {
        organizationId,
        phoneJid,
        key,
      },
    },
  });
}

export async function setBaileysAuthState(organizationId: number, phoneJid: string, key: string, value: Buffer) {
  return prisma.baileysAuthState.upsert({
    where: {
      organizationId_phoneJid_key: {
        organizationId,
        phoneJid,
        key,
      },
    },
    update: { value },
    create: { organizationId, phoneJid, key, value },
  });
}

export async function removeBaileysAuthState(organizationId: number, phoneJid: string, key: string) {
  return prisma.baileysAuthState.deleteMany({
    where: { organizationId, phoneJid, key },
  });
}
