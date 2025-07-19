// src/controllers/chatAssignmentController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * Назначает чат определенному оператору
 */
export const assignChatToOperator = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const { chatId, operatorId, priority = 'medium' } = req.body;

  if (!organizationId) {
    logger.warn('[assignChatToOperator] organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  if (!chatId || isNaN(parseInt(chatId, 10))) {
    logger.warn(`[assignChatToOperator] Некорректный chatId: "${chatId}"`);
    return res.status(400).json({ error: 'Некорректный chatId' });
  }

  if (!operatorId) {
    logger.warn('[assignChatToOperator] operatorId не указан');
    return res.status(400).json({ error: 'operatorId обязателен' });
  }

  try {
    const chatIdNum = parseInt(chatId, 10);
    
    // Проверяем, что чат принадлежит организации
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatIdNum,
        organizationId: organizationId,
      },
    });

    if (!chat) {
      logger.warn(`[assignChatToOperator] Чат с ID ${chatIdNum} не найден для организации ${organizationId}`);
      return res.status(404).json({ error: 'Чат не найден' });
    }

    // Проверяем, что оператор принадлежит организации
    const operator = await prisma.user.findFirst({
      where: {
        id: operatorId,
        organizationId: organizationId,
      },
    });

    if (!operator) {
      logger.warn(`[assignChatToOperator] Оператор с ID ${operatorId} не найден для организации ${organizationId}`);
      return res.status(404).json({ error: 'Оператор не найден' });
    }

    // Назначаем чат оператору
    const updatedChat = await prisma.chat.update({
      where: { id: chatIdNum },
      data: {
        assignedUserId: operatorId,
        assignedAt: new Date(),
        status: 'open',
      },
      include: {
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    logger.info(`✅ Чат ${chatId} назначен оператору ${operatorId} (${operator.name})`);
    res.status(200).json({
      success: true,
      chat: updatedChat,
      message: `Чат назначен оператору ${operator.name}`,
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при назначении чата ${chatId} оператору ${operatorId}:`, error);
    res.status(500).json({
      error: 'Не удалось назначить чат оператору',
      details: error.message,
    });
  }
};

/**
 * Снимает назначение чата с оператора
 */
export const unassignChat = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const { chatId } = req.body;

  if (!organizationId) {
    logger.warn('[unassignChat] organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  if (!chatId || isNaN(parseInt(chatId, 10))) {
    logger.warn(`[unassignChat] Некорректный chatId: "${chatId}"`);
    return res.status(400).json({ error: 'Некорректный chatId' });
  }

  try {
    const chatIdNum = parseInt(chatId, 10);
    
    // Проверяем, что чат принадлежит организации
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatIdNum,
        organizationId: organizationId,
      },
    });

    if (!chat) {
      logger.warn(`[unassignChat] Чат с ID ${chatIdNum} не найден для организации ${organizationId}`);
      return res.status(404).json({ error: 'Чат не найден' });
    }

    // Снимаем назначение
    const updatedChat = await prisma.chat.update({
      where: { id: chatIdNum },
      data: {
        assignedUserId: null,
        assignedAt: null,
        status: 'pending',
      },
    });

    logger.info(`✅ Назначение чата ${chatId} снято`);
    res.status(200).json({
      success: true,
      chat: updatedChat,
      message: 'Назначение чата снято',
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при снятии назначения чата ${chatId}:`, error);
    res.status(500).json({
      error: 'Не удалось снять назначение чата',
      details: error.message,
    });
  }
};

/**
 * Получает список всех чатов, назначенных текущему оператору за определенный промежуток времени
 * Поддерживает фильтрацию по времени: ?from=2024-01-01T00:00:00Z&to=2024-01-02T23:59:59Z
 * Поддерживает фильтрацию по статусу: ?status=open (опционально)
 * Возвращает чаты со всеми статусами (open, pending, closed) если статус не указан
 */
export const getMyAssignedChats = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;
  const { from, to, status } = req.query;

  if (!organizationId || !userId) {
    logger.warn('[getMyAssignedChats] organizationId или userId не определены в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  try {
    // Построение фильтра по времени
    let dateFilter: any = {};
    
    if (from || to) {
      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : new Date(); // Если "до" не указано, используем текущее время
      
      // Валидация дат
      if (fromDate && isNaN(fromDate.getTime())) {
        logger.warn(`[getMyAssignedChats] Некорректная дата "from": "${from}"`);
        return res.status(400).json({ error: 'Некорректная дата "from". Используйте формат ISO 8601.' });
      }
      
      if (isNaN(toDate.getTime())) {
        logger.warn(`[getMyAssignedChats] Некорректная дата "to": "${to}"`);
        return res.status(400).json({ error: 'Некорректная дата "to". Используйте формат ISO 8601.' });
      }

      // Добавляем фильтр по времени последнего сообщения
      if (fromDate && toDate) {
        dateFilter.lastMessageAt = {
          gte: fromDate,
          lte: toDate,
        };
      } else if (fromDate) {
        dateFilter.lastMessageAt = {
          gte: fromDate,
        };
      } else if (toDate) {
        dateFilter.lastMessageAt = {
          lte: toDate,
        };
      }
      
      logger.info(`[getMyAssignedChats] Применен фильтр по времени: от ${fromDate?.toISOString() || 'не указано'} до ${toDate.toISOString()}`);
    }
    const assignedChats = await prisma.chat.findMany({
      where: {
        organizationId: organizationId,
        // assignedUserId: userId,
        // Опциональная фильтрация по статусу
        ...(status && typeof status === 'string' ? { status } : {}),
        ...dateFilter, // Добавляем фильтр по времени
      },
      include: {
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
            displayName: true,
          },
        },
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
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
            senderJid: true,
            timestamp: true,
            fromMe: true,
            type: true,
            isReadByOperator: true,
          },
        },
      },
      orderBy: [
        { priority: 'desc' },
        { unreadCount: 'desc' },
        { lastMessageAt: 'desc' },
      ],
    });

    // Преобразуем результат для удобства
    const chatsWithLastMessage = assignedChats.map(chat => ({
      ...chat,
      lastMessage: chat.messages.length > 0 ? chat.messages[0] : null,
      messages: undefined,
    }));

    logger.info(`✅ Получено ${assignedChats.length} назначенных чатов для пользователя ${userId}${from || to ? ' с фильтром по времени' : ''}`);
    res.status(200).json({ 
      chats: chatsWithLastMessage,
      total: assignedChats.length,
      filters: {
        from: from ? new Date(from as string).toISOString() : null,
        to: to ? new Date(to as string).toISOString() : (from ? new Date().toISOString() : null)
      }
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при получении назначенных чатов для пользователя ${userId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить назначенные чаты',
      details: error.message,
    });
  }
};

/**
 * Получает список всех неназначенных чатов для организации
 * Поддерживает фильтрацию по времени: ?from=2024-01-01T00:00:00Z&to=2024-01-02T23:59:59Z
 */
export const getUnassignedChats = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const { from, to } = req.query;

  if (!organizationId) {
    logger.warn('[getUnassignedChats] organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  try {
    // Построение фильтра по времени
    let dateFilter: any = {};
    
    if (from || to) {
      const fromDate = from ? new Date(from as string) : undefined;
      const toDate = to ? new Date(to as string) : new Date(); // Если "до" не указано, используем текущее время
      
      // Валидация дат
      if (fromDate && isNaN(fromDate.getTime())) {
        logger.warn(`[getUnassignedChats] Некорректная дата "from": "${from}"`);
        return res.status(400).json({ error: 'Некорректная дата "from". Используйте формат ISO 8601.' });
      }
      
      if (isNaN(toDate.getTime())) {
        logger.warn(`[getUnassignedChats] Некорректная дата "to": "${to}"`);
        return res.status(400).json({ error: 'Некорректная дата "to". Используйте формат ISO 8601.' });
      }

      // Добавляем фильтр по времени последнего сообщения
      if (fromDate && toDate) {
        dateFilter.lastMessageAt = {
          gte: fromDate,
          lte: toDate,
        };
      } else if (fromDate) {
        dateFilter.lastMessageAt = {
          gte: fromDate,
        };
      } else if (toDate) {
        dateFilter.lastMessageAt = {
          lte: toDate,
        };
      }
      
      logger.info(`[getUnassignedChats] Применен фильтр по времени: от ${fromDate?.toISOString() || 'не указано'} до ${toDate.toISOString()}`);
    }
    const unassignedChats = await prisma.chat.findMany({
      where: {
        organizationId: organizationId,
        assignedUserId: null,
        status: {
          in: ['open', 'pending'],
        },
        ...dateFilter, // Добавляем фильтр по времени
      },
      include: {
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
            senderJid: true,
            timestamp: true,
            fromMe: true,
            type: true,
            isReadByOperator: true,
          },
        },
      },
      orderBy: [
        { priority: 'desc' },
        { unreadCount: 'desc' },
        { lastMessageAt: 'desc' },
      ],
    });

    // Преобразуем результат для удобства
    const chatsWithLastMessage = unassignedChats.map(chat => ({
      ...chat,
      lastMessage: chat.messages.length > 0 ? chat.messages[0] : null,
      messages: undefined,
    }));

    logger.info(`✅ Получено ${unassignedChats.length} неназначенных чатов для организации ${organizationId}${from || to ? ' с фильтром по времени' : ''}`);
    res.status(200).json({ 
      chats: chatsWithLastMessage,
      total: unassignedChats.length,
      filters: {
        from: from ? new Date(from as string).toISOString() : null,
        to: to ? new Date(to as string).toISOString() : (from ? new Date().toISOString() : null)
      }
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при получении неназначенных чатов для организации ${organizationId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить неназначенные чаты',
      details: error.message,
    });
  }
};

/**
 * Изменяет приоритет чата
 */
export const setChatPriority = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const { chatId, priority } = req.body;

  if (!organizationId) {
    logger.warn('[setChatPriority] organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  if (!chatId || isNaN(parseInt(chatId, 10))) {
    logger.warn(`[setChatPriority] Некорректный chatId: "${chatId}"`);
    return res.status(400).json({ error: 'Некорректный chatId' });
  }

  if (!['low', 'normal', 'high', 'urgent'].includes(priority)) {
    logger.warn(`[setChatPriority] Некорректный приоритет: "${priority}"`);
    return res.status(400).json({ error: 'Некорректный приоритет. Допустимые значения: low, normal, high, urgent' });
  }

  try {
    const chatIdNum = parseInt(chatId, 10);
    
    // Проверяем, что чат принадлежит организации
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatIdNum,
        organizationId: organizationId,
      },
    });

    if (!chat) {
      logger.warn(`[setChatPriority] Чат с ID ${chatIdNum} не найден для организации ${organizationId}`);
      return res.status(404).json({ error: 'Чат не найден' });
    }

    // Обновляем приоритет
    const updatedChat = await prisma.chat.update({
      where: { id: chatIdNum },
      data: { priority },
    });

    logger.info(`✅ Приоритет чата ${chatIdNum} изменен на ${priority}`);
    res.status(200).json({
      success: true,
      chat: updatedChat,
      message: `Приоритет чата изменен на ${priority}`,
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при изменении приоритета чата ${chatId}:`, error);
    res.status(500).json({
      error: 'Не удалось изменить приоритет чата',
      details: error.message,
    });
  }
};

/**
 * Закрывает чат
 */
export const closeChat = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const { chatId, reason } = req.body;

  if (!organizationId) {
    logger.warn('[closeChat] organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  if (!chatId || isNaN(parseInt(chatId, 10))) {
    logger.warn(`[closeChat] Некорректный chatId: "${chatId}"`);
    return res.status(400).json({ error: 'Некорректный chatId' });
  }

  try {
    const chatIdNum = parseInt(chatId, 10);
    
    // Проверяем, что чат принадлежит организации
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatIdNum,
        organizationId: organizationId,
      },
    });

    if (!chat) {
      logger.warn(`[closeChat] Чат с ID ${chatIdNum} не найден для организации ${organizationId}`);
      return res.status(404).json({ error: 'Чат не найден' });
    }

    // Закрываем чат
    const updatedChat = await prisma.chat.update({
      where: { id: chatIdNum },
      data: {
        status: 'closed',
        unreadCount: 0, // Сбрасываем счетчик непрочитанных при закрытии
      },
    });

    logger.info(`✅ Чат ${chatId} закрыт`);
    res.status(200).json({
      success: true,
      chat: updatedChat,
      message: 'Чат закрыт',
    });
  } catch (error: any) {
    logger.error(`❌ Ошибка при закрытии чата ${chatId}:`, error);
    res.status(500).json({
      error: 'Не удалось закрыть чат',
      details: error.message,
    });
  }
};
