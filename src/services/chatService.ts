// src/services/chatService.ts
import { prisma } from '../config/authStorage';
import pino from 'pino';
import { chatVisibilityWhere, messageVisibilityWhere } from '../auth/hrAccess';

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

export async function getChatsByOrganizationSortedByLastMessage(organizationId: number, canAccessHrChats = false) {
  try {
    const chats = await prisma.chat.findMany({
      where: {
        organizationId: organizationId,
        ...chatVisibilityWhere(canAccessHrChats),
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
        // Включаем информацию о клиентах
        organizationClients: {
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            clientType: true,
            segment: true,
            status: true,
            whatsappJid: true,
            telegramUserId: true,
          },
        },
        websiteSession: {
          select: {
            visitorName: true,
            visitorEmail: true,
            visitorPhone: true,
            lastSeenAt: true,
          },
        },
        // --- ИЗМЕНЕНИЕ ЗДЕСЬ: Добавляем orderBy для messages, чтобы получить последнее ---
        messages: {
          where: messageVisibilityWhere(canAccessHrChats),
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
        _count: {
          select: {
            messages: {
              where: {
                ...messageVisibilityWhere(canAccessHrChats),
                isReadByOperator: false,
                fromMe: false,
              },
            },
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
      websiteVisitor: chat.channel === 'website' && chat.websiteSession
        ? {
            name: chat.websiteSession.visitorName,
            email: chat.websiteSession.visitorEmail,
            phone: chat.websiteSession.visitorPhone,
            lastSeenAt: chat.websiteSession.lastSeenAt,
          }
        : null,
      unreadCount: chat._count.messages,
      lastMessage: chat.messages.length > 0 ? chat.messages[0] : null,
      messages: undefined, // Удаляем исходный массив messages, чтобы избежать дублирования
      _count: undefined,
    }));

    return chatsWithLastMessage;
  } catch (error: any) {
    logger.error(`❌ Ошибка в getChatsByOrganizationSortedByLastMessage для организации ${organizationId}:`, error);
    throw error; // Перебрасываем ошибку для обработки в контроллере
  }
}
