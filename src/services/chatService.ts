// import prisma from '../config/prisma';

// export async function createChat(
//   organizationId: number,
//   clientId: number,
//   operatorId: number,
//   status: string = 'open'
// ) {
//   return prisma.chat.create({
//     data: {
//       organizationId,
//       clientId,
//       operatorId,
//       status,
//     },
//   });
// }

// export async function getChatsByOrganization(organizationId: number) {
//   return prisma.chat.findMany({
//     where: { organizationId },
//     orderBy: { createdAt: 'desc' },
//   });
// }

// export async function getChatById(id: number) {
//   return prisma.chat.findUnique({
//     where: { id },
//   });
// }

// export async function updateChat(id: number, data: Partial<{
//   clientId: number;
//   operatorId: number;
//   status: string;
// }>) {
//   return prisma.chat.update({
//     where: { id },
//     data,
//   });
// }

// export async function deleteChat(id: number) {
//   return prisma.chat.delete({
//     where: { id },
//   });
// }
