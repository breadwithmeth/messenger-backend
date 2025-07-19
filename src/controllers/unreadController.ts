// src/controllers/unreadController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * Отметить сообщения как прочитанные
 */
export const markMessagesAsRead = async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const { messageIds } = req.body; // Массив ID сообщений для отметки как прочитанные
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;

  try {
    // Проверяем, что чат принадлежит организации
    const chat = await prisma.chat.findUnique({
      where: {
        id: parseInt(chatId),
        organizationId: organizationId,
      },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Чат не найден' });
    }

    let whereCondition: any = {
      chatId: parseInt(chatId),
      organizationId: organizationId,
      isReadByOperator: false,
      fromMe: false, // Только входящие сообщения могут быть отмечены как прочитанные
    };

    // Если указаны конкретные сообщения, отмечаем только их
    if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
      whereCondition.id = { in: messageIds.map(id => parseInt(id)) };
    }

    // Обновляем сообщения
    const updateResult = await prisma.message.updateMany({
      where: whereCondition,
      data: {
        isReadByOperator: true,
        readAt: new Date(),
      },
    });

    // Пересчитываем количество непрочитанных сообщений в чате
    const unreadCount = await prisma.message.count({
      where: {
        chatId: parseInt(chatId),
        isReadByOperator: false,
        fromMe: false,
      },
    });

    // Обновляем счетчик в чате
    await prisma.chat.update({
      where: { id: parseInt(chatId) },
      data: { unreadCount },
    });

    logger.info(`[markMessagesAsRead] Отмечено как прочитанные ${updateResult.count} сообщений в чате ${chatId}`);
    
    res.json({
      success: true,
      markedCount: updateResult.count,
      unreadCount,
      message: `Отмечено как прочитанные ${updateResult.count} сообщений`,
    });
  } catch (error: any) {
    logger.error(`[markMessagesAsRead] Ошибка отметки сообщений как прочитанные:`, error);
    res.status(500).json({ error: 'Ошибка отметки сообщений', details: error.message });
  }
};

/**
 * Отметить весь чат как прочитанный
 */
export const markChatAsRead = async (req: Request, res: Response) => {
  const { chatId } = req.params;
  const organizationId = res.locals.organizationId;

  try {
    const chat = await prisma.chat.findUnique({
      where: {
        id: parseInt(chatId),
        organizationId: organizationId,
      },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Чат не найден' });
    }

    // Отмечаем все непрочитанные входящие сообщения как прочитанные
    const updateResult = await prisma.message.updateMany({
      where: {
        chatId: parseInt(chatId),
        isReadByOperator: false,
        fromMe: false,
      },
      data: {
        isReadByOperator: true,
        readAt: new Date(),
      },
    });

    // Обнуляем счетчик непрочитанных в чате
    await prisma.chat.update({
      where: { id: parseInt(chatId) },
      data: { unreadCount: 0 },
    });

    logger.info(`[markChatAsRead] Весь чат ${chatId} отмечен как прочитанный (${updateResult.count} сообщений)`);
    
    res.json({
      success: true,
      markedCount: updateResult.count,
      message: `Чат отмечен как прочитанный`,
    });
  } catch (error: any) {
    logger.error(`[markChatAsRead] Ошибка отметки чата как прочитанный:`, error);
    res.status(500).json({ error: 'Ошибка отметки чата', details: error.message });
  }
};

/**
 * Получить количество непрочитанных сообщений
 */
export const getUnreadCounts = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;

  try {
    // Общее количество непрочитанных сообщений для организации
    const totalUnreadMessages = await prisma.message.count({
      where: {
        organizationId: organizationId,
        isReadByOperator: false,
        fromMe: false,
      },
    });

    // Количество чатов с непрочитанными сообщениями
    const chatsWithUnread = await prisma.chat.count({
      where: {
        organizationId: organizationId,
        unreadCount: { gt: 0 },
      },
    });

    // Непрочитанные сообщения в назначенных текущему пользователю чатах
    const assignedUnreadMessages = await prisma.message.count({
      where: {
        organizationId: organizationId,
        isReadByOperator: false,
        fromMe: false,
        chat: {
          assignedUserId: userId,
        },
      },
    });

    // Количество назначенных чатов с непрочитанными
    const assignedChatsWithUnread = await prisma.chat.count({
      where: {
        organizationId: organizationId,
        assignedUserId: userId,
        unreadCount: { gt: 0 },
      },
    });

    res.json({
      total: {
        unreadMessages: totalUnreadMessages,
        chatsWithUnread: chatsWithUnread,
      },
      assigned: {
        unreadMessages: assignedUnreadMessages,
        chatsWithUnread: assignedChatsWithUnread,
      },
    });
  } catch (error: any) {
    logger.error(`[getUnreadCounts] Ошибка получения статистики непрочитанных:`, error);
    res.status(500).json({ error: 'Ошибка получения статистики', details: error.message });
  }
};

/**
 * Получить чаты с непрочитанными сообщениями
 */
export const getChatsWithUnread = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const { assignedOnly } = req.query;
  const userId = res.locals.userId;

  try {
    let whereCondition: any = {
      organizationId: organizationId,
      unreadCount: { gt: 0 },
    };

    // Если запрашиваются только назначенные чаты
    if (assignedOnly === 'true') {
      whereCondition.assignedUserId = userId;
    }

    const chats = await prisma.chat.findMany({
      where: whereCondition,
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
            displayName: true,
          },
        },
        messages: {
          take: 1,
          orderBy: {
            timestamp: 'desc',
          },
          select: {
            id: true,
            content: true,
            timestamp: true,
            fromMe: true,
            type: true,
            isReadByOperator: true,
          },
        },
      },
      orderBy: [
        { unreadCount: 'desc' },
        { lastMessageAt: 'desc' },
      ],
    });

    const chatsWithLastMessage = chats.map(chat => ({
      ...chat,
      lastMessage: chat.messages.length > 0 ? chat.messages[0] : null,
      messages: undefined,
    }));

    res.json({
      chats: chatsWithLastMessage,
      total: chats.length,
    });
  } catch (error: any) {
    logger.error(`[getChatsWithUnread] Ошибка получения чатов с непрочитанными:`, error);
    res.status(500).json({ error: 'Ошибка получения чатов', details: error.message });
  }
};
