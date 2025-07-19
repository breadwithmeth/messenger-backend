// src/controllers/messageReadController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * Отмечает сообщения в чате как прочитанные
 */
export const markMessagesAsRead = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;
  const chatId = parseInt(req.params.chatId, 10);
  if (!organizationId || !userId) {
    logger.warn('[markMessagesAsRead] organizationId или userId не определены в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  if (isNaN(chatId)) {
    logger.warn(`[markMessagesAsRead] Некорректный chatId: "${req.params.chatId}"`);
    return res.status(400).json({ error: 'Некорректный chatId' });
  }

  try {
    // Проверяем, что чат принадлежит организации
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        organizationId: organizationId,
      },
    });

    if (!chat) {
      logger.warn(`[markMessagesAsRead] Чат с ID ${chatId} не найден для организации ${organizationId}`);
      return res.status(404).json({ error: 'Чат не найден' });
    }

    // Получаем количество непрочитанных сообщений перед обновлением
    const unreadCount = await prisma.message.count({
      where: {
        chatId: chatId,
        organizationId: organizationId,
        isReadByOperator: false,
        fromMe: false, // Только входящие сообщения
      },
    });

    // Отмечаем все непрочитанные сообщения в чате как прочитанные
    const updateResult = await prisma.message.updateMany({
      where: {
        chatId: chatId,
        organizationId: organizationId,
        isReadByOperator: false,
        fromMe: false, // Только входящие сообщения
      },
      data: {
        isReadByOperator: true,
        readAt: new Date(),
      },
    });

    // Обнуляем счетчик непрочитанных сообщений в чате
    await prisma.chat.update({
      where: { id: chatId },
      data: { unreadCount: 0 },
    });

    logger.info(`✅ Отмечено как прочитанное ${updateResult.count} сообщений в чате ${chatId} пользователем ${userId}`);
    
    res.status(200).json({
      success: true,
      markedAsRead: updateResult.count,
      message: `Отмечено как прочитанное ${updateResult.count} сообщений`,
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при отметке сообщений как прочитанных в чате ${chatId}:`, error);
    res.status(500).json({
      error: 'Не удалось отметить сообщения как прочитанные',
      details: error.message,
    });
  }
};

/**
 * Получает количество непрочитанных сообщений для пользователя
 */
export const getUnreadCount = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;

  if (!organizationId || !userId) {
    logger.warn('[getUnreadCount] organizationId или userId не определены в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  try {
    // Получаем общий счетчик непрочитанных сообщений для назначенных пользователю чатов
    const totalUnreadCount = await prisma.message.count({
      where: {
        organizationId: organizationId,
        isReadByOperator: false,
        fromMe: false, // Только входящие сообщения
        chat: {
          assignedUserId: userId,
          status: {
            in: ['open', 'pending'],
          },
        },
      },
    });

    // Получаем количество непрочитанных сообщений по чатам
    const unreadByChat = await prisma.chat.findMany({
      where: {
        organizationId: organizationId,
        assignedUserId: userId,
        status: {
          in: ['open', 'pending'],
        },
        unreadCount: {
          gt: 0,
        },
      },
      select: {
        id: true,
        name: true,
        remoteJid: true,
        unreadCount: true,
        lastMessageAt: true,
      },
      orderBy: {
        lastMessageAt: 'desc',
      },
    });

    res.status(200).json({
      totalUnreadCount,
      unreadByChat,
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при получении счетчика непрочитанных сообщений для пользователя ${userId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить счетчик непрочитанных сообщений',
      details: error.message,
    });
  }
};

/**
 * Получает статистику по сообщениям для организации
 */
export const getMessageStats = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;

  if (!organizationId) {
    logger.warn('[getMessageStats] organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  try {
    // Общая статистика по чатам
    const totalChats = await prisma.chat.count({
      where: { organizationId },
    });

    const openChats = await prisma.chat.count({
      where: {
        organizationId,
        status: 'open',
      },
    });

    const assignedChats = await prisma.chat.count({
      where: {
        organizationId,
        assignedUserId: {
          not: null,
        },
        status: {
          in: ['open', 'pending'],
        },
      },
    });

    const unassignedChats = await prisma.chat.count({
      where: {
        organizationId,
        assignedUserId: null,
        status: {
          in: ['open', 'pending'],
        },
      },
    });

    // Статистика по сообщениям
    const totalMessages = await prisma.message.count({
      where: { organizationId },
    });

    const totalUnreadMessages = await prisma.message.count({
      where: {
        organizationId,
        isReadByOperator: false,
        fromMe: false,
      },
    });

    // Статистика по операторам
    const operatorStats = await prisma.user.findMany({
      where: {
        organizationId,
        role: 'operator',
      },
      select: {
        id: true,
        name: true,
        email: true,
        _count: {
          select: {
            assignedChats: {
              where: {
                status: {
                  in: ['open', 'pending'],
                },
              },
            },
          },
        },
      },
    });

    res.status(200).json({
      chats: {
        total: totalChats,
        open: openChats,
        assigned: assignedChats,
        unassigned: unassignedChats,
      },
      messages: {
        total: totalMessages,
        unread: totalUnreadMessages,
      },
      operators: operatorStats,
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при получении статистики сообщений для организации ${organizationId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить статистику сообщений',
      details: error.message,
    });
  }
};
