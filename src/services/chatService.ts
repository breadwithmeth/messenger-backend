// src/services/chatService.ts
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

export async function getChatsByOrganizationSortedByLastMessage(organizationId: number) {
  try {
    const chats = await prisma.chat.findMany({
      where: {
        organizationId: organizationId,
      },
      orderBy: [
        { priority: 'desc' }, // Сначала по приоритету
        { unreadCount: 'desc' }, // Затем по количеству непрочитанных
        { lastMessageAt: 'desc' }, // Затем по дате последнего сообщения
      ],
      include: {
        organizationPhone: { // Включаем информацию о телефоне организации
          select: {
            id: true,
            phoneJid: true,
            displayName: true,
          },
        },
        // Включаем информацию о назначенном операторе
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        // --- ИЗМЕНЕНИЕ ЗДЕСЬ: Добавляем orderBy для messages, чтобы получить последнее ---
        messages: {
          take: 1, // Берем только одно сообщение
          orderBy: {
            timestamp: 'desc', // Сортируем сообщения в чате по убыванию времени (самое новое будет первым)
          },
          select: {
            id: true,
            content: true,
            senderJid: true,
            timestamp: true,
            fromMe: true,
            type: true,
            isReadByOperator: true,
          },
        },
        // --- КОНЕЦ ИЗМЕНЕНИЯ ---
      },
    });

    logger.info(`✅ Получено ${chats.length} чатов для организации ${organizationId}.`);

    // Если вы хотите, чтобы последнее сообщение было легко доступно как `chat.lastMessage`,
    // можно слегка преобразовать результат.
    const chatsWithLastMessage = chats.map(chat => ({
      ...chat,
      lastMessage: chat.messages.length > 0 ? chat.messages[0] : null,
      messages: undefined, // Удаляем исходный массив messages, чтобы избежать дублирования
    }));

    return chatsWithLastMessage;
  } catch (error: any) {
    logger.error(`❌ Ошибка в getChatsByOrganizationSortedByLastMessage для организации ${organizationId}:`, error);
    throw error; // Перебрасываем ошибку для обработки в контроллере
  }
}