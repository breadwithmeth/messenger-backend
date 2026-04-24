// src/controllers/chatController.ts

import { Request, Response } from 'express';
import * as chatService from '../services/chatService';
import pino from 'pino';
import { prisma } from '../config/authStorage'; // Используем единый клиент Prisma

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

type TicketHistoryPoint = {
  oldValue: string | null;
  newValue: string | null;
  createdAt: Date;
};

type TicketTransition = {
  oldNumber: number | null;
  newNumber: number;
  createdAt: Date;
};

function buildTicketTransitions(history: TicketHistoryPoint[] = []): TicketTransition[] {
  return history
    .map((item) => {
      const newNumber = item.newValue ? Number(item.newValue) : NaN;
      const oldNumber = item.oldValue ? Number(item.oldValue) : NaN;

      if (Number.isNaN(newNumber)) {
        return null;
      }

      return {
        oldNumber: Number.isNaN(oldNumber) ? null : oldNumber,
        newNumber,
        createdAt: item.createdAt,
      };
    })
    .filter((item): item is TicketTransition => item !== null)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

// Получить комментарии чата
export const getChatComments = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const chatId = parseInt(req.params.chatId as string, 10);
  const { limit = '50', offset = '0' } = req.query;

  if (!organizationId) {
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  if (Number.isNaN(chatId)) {
    return res.status(400).json({ error: 'Некорректный chatId' });
  }

  try {
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, organizationId },
      select: { id: true },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Чат не найден' });
    }

    const take = Math.min(parseInt(limit as string, 10) || 50, 200);
    const skip = parseInt(offset as string, 10) || 0;

    const [comments, total] = await Promise.all([
      prisma.chatComment.findMany({
        where: { chatId, organizationId },
        include: {
          user: {
            select: { id: true, name: true, email: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      prisma.chatComment.count({ where: { chatId, organizationId } }),
    ]);

    return res.json({
      comments,
      pagination: {
        total,
        limit: take,
        offset: skip,
        hasMore: skip + take < total,
      },
    });
  } catch (error) {
    logger.error('[getChatComments] Ошибка получения комментариев:', error);
    return res.status(500).json({ error: 'Failed to fetch chat comments' });
  }
};

// Добавить комментарий к чату
export const addChatComment = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;
  const chatId = parseInt(req.params.chatId as string, 10);
  const { content } = req.body || {};

  if (!organizationId || !userId) {
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  if (Number.isNaN(chatId)) {
    return res.status(400).json({ error: 'Некорректный chatId' });
  }

  if (!content || typeof content !== 'string' || !content.trim()) {
    return res.status(400).json({ error: 'Content is required' });
  }

  try {
    const chat = await prisma.chat.findFirst({
      where: { id: chatId, organizationId },
      select: { id: true },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Чат не найден' });
    }

    const comment = await prisma.chatComment.create({
      data: {
        chatId,
        organizationId,
        userId,
        content: content.trim(),
      },
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    });

    return res.status(201).json(comment);
  } catch (error) {
    logger.error('[addChatComment] Ошибка добавления комментария:', error);
    return res.status(500).json({ error: 'Failed to add chat comment' });
  }
};

function extractTicketTimeline(
  currentTicketNumber: number | null,
  currentStatus: string | null,
  currentPriority: string | null,
  history: TicketHistoryPoint[] = []
) {
  const timeline: Array<{ number: number; status: string | null; priority: string | null; createdAt?: Date }> = [];
  const seen = new Set<number>();

  if (typeof currentTicketNumber === 'number') {
    timeline.push({
      number: currentTicketNumber,
      status: currentStatus,
      priority: currentPriority,
    });
    seen.add(currentTicketNumber);
  }

  for (const item of history) {
    const oldNumber = item.oldValue ? Number(item.oldValue) : NaN;
    const newNumber = item.newValue ? Number(item.newValue) : NaN;

    if (!Number.isNaN(newNumber) && !seen.has(newNumber)) {
      timeline.push({
        number: newNumber,
        status: null,
        priority: null,
        createdAt: item.createdAt,
      });
      seen.add(newNumber);
    }

    if (!Number.isNaN(oldNumber) && !seen.has(oldNumber)) {
      timeline.push({
        number: oldNumber,
        status: null,
        priority: null,
        createdAt: item.createdAt,
      });
      seen.add(oldNumber);
    }
  }

  return timeline;
}

function resolveMessageTicket(
  messageTimestamp: Date,
  currentTicketNumber: number | null,
  currentStatus: string | null,
  currentPriority: string | null,
  history: TicketHistoryPoint[] = []
) {
  const transitions = buildTicketTransitions(history);
  let resolvedNumber: number | null = currentTicketNumber;

  if (transitions.length > 0) {
    const messageTime = messageTimestamp.getTime();
    const firstTransition = transitions[0];

    if (messageTime < firstTransition.createdAt.getTime()) {
      resolvedNumber = firstTransition.oldNumber ?? firstTransition.newNumber;
    } else {
      resolvedNumber = firstTransition.newNumber;
      for (const transition of transitions) {
        if (messageTime >= transition.createdAt.getTime()) {
          resolvedNumber = transition.newNumber;
        } else {
          break;
        }
      }
    }
  }

  const isCurrentTicket = resolvedNumber !== null && currentTicketNumber !== null && resolvedNumber === currentTicketNumber;

  return {
    ticketNumber: resolvedNumber,
    ticketStatus: isCurrentTicket ? currentStatus : null,
    ticketPriority: isCurrentTicket ? currentPriority : null,
  };
}

// export async function createChat(req: Request, res: Response) {
//   try {
//     const { organizationId, clientId, operatorId } = req.body;
//     if (!organizationId || !clientId || !operatorId) {
//       return res.status(400).json({ error: 'Не указаны обязательные поля' });
//     }

//     const chat = await chatService.createChat(organizationId, clientId, operatorId);
//     res.json(chat);
//   } catch (err) {
//     res.status(500).json({ error: 'Ошибка создания чата' });
//   }
// }

export async function listChats(req: Request, res: Response) {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId; // ID текущего пользователя
    const { 
      status, 
      assigned, 
      assignedToMe, // Новый параметр для фильтрации по текущему пользователю
      priority, 
      channel, 
      includeProfile, 
      search, // Новый параметр для поиска по тексту сообщения или номеру телефона
      searchType, // 'message', 'phone', или 'all' (по умолчанию)
      limit = '50', 
      offset = '0',
      sortBy = 'lastMessageAt', // Поле для сортировки
      sortOrder = 'desc' // Направление сортировки (asc/desc)
    } = req.query;
    
    if (!organizationId) {
      logger.warn('[listChats] organizationId не определен в res.locals.');
      return res.status(400).json({ error: 'organizationId обязателен' });
    }

    // Парсинг пагинации
    const take = Math.min(parseInt(limit as string, 10) || 50, 100); // Максимум 100 чатов за раз
    const skip = parseInt(offset as string, 10) || 0;

    // Построение условий фильтрации
    let whereCondition: any = {
      organizationId: organizationId,
    };

    // Фильтрация по поиску (текст сообщения или номер телефона)
    if (search && typeof search === 'string' && search.trim().length > 0) {
      const searchQuery = search.trim();
      const searchLower = searchQuery.toLowerCase();
      const searchType_ = searchType === 'message' ? 'message' : searchType === 'phone' ? 'phone' : 'all';

      logger.info(`[listChats] Поиск по: ${searchType_}, запрос: "${searchQuery}"`);

      if (searchType_ === 'phone' || searchType_ === 'all') {
        // Поиск по номеру телефона (remoteJid содержит номер)
        // Номера в формате: 79001234567@s.whatsapp.net или 123456789 (для Telegram)
        whereCondition.OR = whereCondition.OR || [];
        whereCondition.OR.push({
          remoteJid: {
            contains: searchQuery.replace(/\D/g, ''), // Ищем только цифры
            mode: 'insensitive',
          },
        });
        
        // Также ищем в имени чата
        whereCondition.OR.push({
          name: {
            contains: searchQuery,
            mode: 'insensitive',
          },
        });

        // Для Telegram - поиск по username
        whereCondition.OR.push({
          telegramUsername: {
            contains: searchQuery,
            mode: 'insensitive',
          },
        });
      }

      if (searchType_ === 'message' || searchType_ === 'all') {
        // Поиск по тексту сообщений. Ограничиваем выборку, чтобы не сканировать/возвращать все чаты.
        const matchingMessages = await prisma.message.findMany({
          where: {
            organizationId: organizationId,
            content: {
              contains: searchQuery,
              mode: 'insensitive',
            },
          },
          select: { chatId: true },
          distinct: ['chatId'],
          take: 1000,
        });

        const matchingChatIds = matchingMessages.map((message) => message.chatId);
        if (matchingChatIds.length > 0) {
          whereCondition.OR = whereCondition.OR || [];
          whereCondition.OR.push({
            id: { in: matchingChatIds },
          });
        }
      }

      // Если результат пуст для OR условия, нужно обработать это правильно
      if (whereCondition.OR && whereCondition.OR.length === 0) {
        delete whereCondition.OR;
      }
    }

    // Фильтрация по каналу (whatsapp или telegram)
    if (channel && typeof channel === 'string' && (channel === 'whatsapp' || channel === 'telegram')) {
      whereCondition.channel = channel;
    }

    // Фильтрация по статусу (поддерживаются несколько статусов, разделённых запятой)
    if (status && typeof status === 'string' && status.trim().length > 0) {
      const statuses = status.split(',').map(s => s.trim()).filter(s => s.length > 0);
      const validStatuses = ['open', 'closed'];
      const filteredStatuses = statuses.filter(s => validStatuses.includes(s));
      
      if (filteredStatuses.length > 0) {
        if (filteredStatuses.length === 1) {
          whereCondition.status = filteredStatuses[0];
        } else {
          whereCondition.status = { in: filteredStatuses };
        }
      }
    }

    // Фильтрация по приоритету
    if (priority && typeof priority === 'string') {
      whereCondition.priority = priority;
    }

    // Фильтрация по назначению на текущего пользователя
    if (assignedToMe === 'true') {
      if (!userId) {
        return res.status(400).json({ error: 'userId не определен. Требуется авторизация.' });
      }
      whereCondition.assignedUserId = userId;
    } else if (assigned === 'true') {
      // Все назначенные чаты (любому оператору)
      whereCondition.assignedUserId = { not: null };
    } else if (assigned === 'false') {
      // Неназначенные чаты
      whereCondition.assignedUserId = null;
    }

    // Построение сортировки
    const allowedSortFields = [
      'lastMessageAt', 
      'createdAt', 
      'priority', 
      'unreadCount', 
      'ticketNumber',
      'status',
      'name'
    ];
    
    const sortField = typeof sortBy === 'string' && allowedSortFields.includes(sortBy) 
      ? sortBy 
      : 'lastMessageAt';
    
    const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';

    // Если не указана сортировка, используем умную сортировку по умолчанию
    let orderBy: any;
    if (req.query.sortBy === undefined) {
      // Умная сортировка по умолчанию (многокритериальная)
      orderBy = [
        { priority: 'desc' },      // 1. Сначала приоритетные
        { unreadCount: 'desc' },   // 2. Затем с непрочитанными
        { lastMessageAt: 'desc' }, // 3. Потом по времени
      ];
    } else {
      // Пользовательская сортировка
      orderBy = { [sortField]: sortDirection };
    }

    // Получаем общее количество (для пагинации)
    const totalCount = await prisma.chat.count({ where: whereCondition });

    // Получаем чаты с пагинацией и оптимизированными select
    const chats = await prisma.chat.findMany({
      where: whereCondition,
      take,
      skip,
      select: {
        id: true,
        name: true,
        channel: true, // whatsapp | telegram
        remoteJid: true,
        receivingPhoneJid: true,
        isGroup: true,
        status: true,
        priority: true,
        unreadCount: true,
        lastMessageAt: true,
        ticketNumber: true,
        createdAt: true,
        ticketHistory: {
          where: {
            changeType: {
              in: ['ticket_created', 'ticket_reopened'],
            },
          },
          select: {
            oldValue: true,
            newValue: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 30,
        },
        // WhatsApp specific
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
            displayName: true,
            connectionType: true, // baileys | waba
          },
        },
        // Telegram specific
        telegramBot: {
          select: {
            id: true,
            botUsername: true,
            botName: true,
          },
        },
        telegramChatId: true,
        telegramUsername: true,
        telegramFirstName: true,
        telegramLastName: true,
        // Common
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        // Информация о клиентах
        organizationClients: {
          select: {
            id: true,
            name: true,
            clientType: true,
            segment: true,
            status: true,
            whatsappJid: true,
            telegramUserId: true,
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
            mediaUrl: true,
            quotedMessageId: true,
            quotedContent: true, // Добавлено для отображения реплаев в последнем сообщении
          },
        },
      },
      orderBy: orderBy,
    });

    // Преобразуем результат (без дополнительных запросов к Baileys)
    const wantProfile = String(includeProfile).toLowerCase() === 'true';
    const chatsWithLastMessage = chats.map((chat) => {
      const tickets = extractTicketTimeline(
        chat.ticketNumber,
        chat.status,
        chat.priority,
        chat.ticketHistory || []
      );

      const base: any = {
        ...chat,
        lastMessage: chat.messages.length > 0 ? chat.messages[0] : null,
        ticket: chat.ticketNumber
          ? {
              number: chat.ticketNumber,
              status: chat.status,
              priority: chat.priority,
            }
          : null,
        tickets,
      };
      delete base.messages;
      delete base.ticketHistory;

      if (wantProfile) {
        // Используем уже сохранённые данные из Chat.name
        base.displayName = chat.name || null;
        // Для фото профиля можно добавить отдельный эндпоинт
        base.profilePhotoUrl = null;
      }

      return base;
    });

    res.json({
      chats: chatsWithLastMessage,
      pagination: {
        total: totalCount,
        limit: take,
        offset: skip,
        hasMore: skip + take < totalCount,
      },
    });
  } catch (err: any) {
    logger.error(`[listChats] Ошибка получения чатов для организации ${res.locals.organizationId || 'неизвестно'}:`, err);
    res.status(500).json({ error: 'Ошибка получения чатов', details: err.message });
  }
}

export const getChatMessages = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId;
  const chatId = parseInt(req.params.chatId as string, 10);
  const { limit = '100', offset = '0', before } = req.query;

  if (!organizationId) {
    logger.warn('[getChatMessages] Несанкционированный доступ: organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
  }

  if (isNaN(chatId)) {
    logger.warn(`[getChatMessages] Некорректный chatId: "${req.params.chatId}". Ожидалось число.`);
    return res.status(400).json({ error: 'Некорректный chatId. Ожидалось число.' });
  }

  try {
    // Парсинг пагинации
    const take = Math.min(parseInt(limit as string, 10) || 100, 200); // Максимум 200 сообщений
    const skip = parseInt(offset as string, 10) || 0;

    // Проверяем существование чата (оптимизировано - только id)
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        organizationId: organizationId,
      },
      select: {
        id: true,
        ticketNumber: true,
        status: true,
        priority: true,
        assignedUserId: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
        organizationClients: {
          select: {
            id: true,
          },
          take: 1,
        },
        ticketHistory: {
          where: {
            changeType: {
              in: ['ticket_created', 'ticket_reopened'],
            },
          },
          select: {
            oldValue: true,
            newValue: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 30,
        },
      },
    });

    if (!chat) {
      logger.warn(`[getChatMessages] Чат с ID ${chatId} не найден или не принадлежит организации ${organizationId}.`);
      return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
    }

    // Построение условий запроса
    const whereCondition: any = {
      chatId: chatId,
      organizationId: organizationId,
    };

    // Фильтр "before" для подгрузки старых сообщений (курсорная пагинация)
    if (before && typeof before === 'string') {
      const beforeDate = new Date(before);
      if (!isNaN(beforeDate.getTime())) {
        whereCondition.timestamp = { lt: beforeDate };
      }
    }

    // Для курсорной пагинации (before) полный count слишком дорогой на больших чатах.
    const totalCount = before
      ? null
      : await prisma.message.count({
          where: { chatId, organizationId },
        });

    // Получаем сообщения с оптимизированным select
    const messages = await prisma.message.findMany({
      where: whereCondition,
      take,
      skip,
      select: {
        id: true,
        whatsappMessageId: true,
        content: true,
        senderJid: true,
        receivingPhoneJid: true,
        fromMe: true,
        type: true,
        mediaUrl: true,
        filename: true,
        mimeType: true,
        size: true,
        timestamp: true,
        status: true,
        isReadByOperator: true,
        quotedMessageId: true,
        quotedContent: true, // Добавлено для отображения реплаев
        senderUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
      orderBy: {
        timestamp: 'desc', // Последние сообщения сначала
      },
    });

    // Переворачиваем массив для отображения в хронологическом порядке (старые → новые)
    const messagesInChronologicalOrder = messages.reverse();
    const tickets = extractTicketTimeline(
      chat.ticketNumber,
      chat.status,
      chat.priority,
      chat.ticketHistory || []
    );

    const primaryClientId = chat.organizationClients?.[0]?.id ?? null;

    const hasResponsible = Boolean(chat.assignedUserId);
    const responsibleUser = hasResponsible ? chat.assignedUser : null;

    const messagesWithTicket = messagesInChronologicalOrder.map((message) => {
      const resolvedTicket = resolveMessageTicket(
        message.timestamp,
        chat.ticketNumber,
        chat.status,
        chat.priority,
        chat.ticketHistory || []
      );

      return {
        ...message,
        ticketNumber: resolvedTicket.ticketNumber,
        ticketStatus: resolvedTicket.ticketStatus,
        ticketPriority: resolvedTicket.ticketPriority,
        clientId: primaryClientId,
        hasResponsible,
        responsibleUser,
      };
    });

    res.status(200).json({
      chat: {
        id: chat.id,
      },
      ticket: chat.ticketNumber
        ? {
            number: chat.ticketNumber,
            status: chat.status,
            priority: chat.priority,
          }
        : null,
      tickets,
      messages: messagesWithTicket,
      pagination: {
        total: totalCount,
        limit: take,
        offset: skip,
        hasMore: totalCount === null ? messagesWithTicket.length === take : skip + take < totalCount,
        oldestTimestamp: messagesWithTicket.length > 0 ? messagesWithTicket[0].timestamp : null,
        newestTimestamp: messagesWithTicket.length > 0 ? messagesWithTicket[messagesWithTicket.length - 1].timestamp : null,
      },
    });
  } catch (error: any) {
    logger.error(`[getChatMessages] Ошибка при получении сообщений для чата ${chatId} организации ${organizationId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить сообщения чата.',
      details: error.message,
    });
  }
};