import prisma from '../config/prisma';

// export async function sendMessage(
//   jid: string,
//   content: string,
//   quoted?: any
// ) {
//   // This is a stub. Actual sending should be implemented via Baileys or similar.
//   // Here, just save to DB for demo.
//   return prisma.message.create({
//     data: {
//     //   senderType: 'operator',
//       senderId: 0,
//       content,
//       type: 'text',
//       // Optionally handle quoted, media, etc.
//     },
//   });
// }

// export async function getMessages(chatId: number | string) {
//   return prisma.message.findMany({
//     where: { chatId: Number(chatId) },
//     orderBy: { createdAt: 'asc' },
//   });
// }

export async function getMessageById(id: number) {
  return prisma.message.findUnique({
    where: { id },
  });
}

export async function deleteMessage(id: number) {
  return prisma.message.delete({
    where: { id },
  });
}
