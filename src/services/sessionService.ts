// import prisma from '../config/prisma';

// export async function createSession(data: {
//   organizationId: number;
//   phoneJid: string;
//   status?: string;
//   authState?: any;
// }) {
//   return prisma.session.create({
//     data,
//   });
// }

// export async function getSessionById(id: number) {
//   return prisma.session.findUnique({
//     where: { id },
//   });
// }

// export async function getSessionsByOrganization(organizationId: number) {
//   return prisma.session.findMany({
//     where: { organizationId },
//     orderBy: { createdAt: 'desc' },
//   });
// }

// export async function updateSession(id: number, data: Partial<{
//   phoneJid: string;
//   status: string;
//   authState: any;
// }>) {
//   return prisma.session.update({
//     where: { id },
//     data,
//   });
// }

// export async function deleteSession(id: number) {
//   return prisma.session.delete({
//     where: { id },
//   });
// }
