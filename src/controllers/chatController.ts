// src/controllers/chatController.ts

import { Request, Response } from 'express';
import * as chatService from '../services/chatService';
import pino from 'pino';
import { prisma } from '../config/authStorage'; // Используем единый клиент Prisma

const logger = pino({ level: 'info' });

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
    const { status, assigned, priority, includeProfile } = req.query;
    
    if (!organizationId) {
      logger.warn('[listChats] organizationId не определен в res.locals.');
      return res.status(400).json({ error: 'organizationId обязателен' });
    }

    // Построение условий фильтрации
    let whereCondition: any = {
      organizationId: organizationId,
    };

    // Фильтрация по статусу
    if (status && typeof status === 'string') {
      whereCondition.status = status;
    }

    // Фильтрация по назначению
    if (assigned === 'true') {
      whereCondition.assignedUserId = { not: null };
    } else if (assigned === 'false') {
      whereCondition.assignedUserId = null;
    }

    // Фильтрация по приоритету
    if (priority && typeof priority === 'string') {
      whereCondition.priority = priority;
    }

    // Получаем чаты с расширенной информацией
    const chats = await prisma.chat.findMany({
      where: whereCondition,
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
        { unreadCount: 'desc' }, // Сначала чаты с непрочитанными
        { lastMessageAt: 'desc' },
      ],
    });

    // Преобразуем результат и, по желанию, обогащаем профилем
    const wantProfile = String(includeProfile).toLowerCase() === 'true';
    const chatsWithLastMessage = await Promise.all(chats.map(async (chat) => {
      const base: any = {
        ...chat,
        lastMessage: chat.messages.length > 0 ? chat.messages[0] : null,
      };
      delete base.messages;

      if (wantProfile) {
        try {
          // Имя собеседника: используем Chat.name, оно теперь заполняется из pushName
          base.displayName = chat.name || null;
          // Фото профиля: потребует JID собеседника, это chat.remoteJid
          // Чтобы избежать прямой зависимости на Baileys здесь, можно сделать легкий прокси в waService,
          // но для простоты вернем только поле, которое фронт может запросить отдельным вызовом.
          base.profilePhotoUrl = null; // заполняется отдельным endpoint либо lazy-загрузкой
        } catch (e) {
          base.displayName = base.displayName || null;
          base.profilePhotoUrl = null;
        }
      }

      return base;
    }));

    res.json({
      chats: chatsWithLastMessage,
      total: chats.length,
    });
  } catch (err: any) {
    logger.error(`[listChats] Ошибка получения чатов для организации ${res.locals.organizationId || 'неизвестно'}:`, err);
    res.status(500).json({ error: 'Ошибка получения чатов', details: err.message });
  }
}

export const getChatMessages = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId; // Получаем ID организации из middleware
  const chatId = parseInt(req.params.chatId as string, 10); // Получаем chatId из параметров маршрута

  if (!organizationId) {
    logger.warn('[getChatMessages] Несанкционированный доступ: organizationId не определен в res.locals.');
    return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
  }

  if (isNaN(chatId)) {
    logger.warn(`[getChatMessages] Некорректный chatId: "${req.params.chatId}". Ожидалось число.`);
    return res.status(400).json({ error: 'Некорректный chatId. Ожидалось число.' });
  }

  try {
    // Проверяем, что чат принадлежит данной организации, чтобы предотвратить доступ к чужим чатам
    const chat = await prisma.chat.findUnique({
      where: {
        id: chatId,
        organizationId: organizationId,
      },
      select: { id: true }, // Выбираем только id, т.к. нас интересует только существование чата и его принадлежность
    });

    if (!chat) {
      logger.warn(`[getChatMessages] Чат с ID ${chatId} не найден или не принадлежит организации ${organizationId}.`);
      return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
    }

    // Получаем все сообщения для этого чата, отсортированные по времени
    const messages = await prisma.message.findMany({
      where: {
        chatId: chatId,
        organizationId: organizationId, // Дополнительная проверка на принадлежность сообщения организации
      },
      include: {
        // Включаем информацию о пользователе, который отправил сообщение
        senderUser: {
          select: {
            id: true,
            name: true,
            email: true, // Можно добавить другие нужные поля
          },
        },
      },
      orderBy: {
        timestamp: 'asc', // Сортируем по возрастанию времени для хронологического порядка
      },
    });

    // logger.info(`[getChatMessages] Успешно получено ${messages.length} сообщений для чата ${chatId} организации ${organizationId}.`);
    res.status(200).json({ messages });
  } catch (error: any) {
    logger.error(`[getChatMessages] Ошибка при получении сообщений для чата ${chatId} организации ${organizationId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить сообщения чата.',
      details: error.message,
    });
  }
};