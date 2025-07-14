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
    const organizationId = res.locals.organizationId; // Получаем organizationId из токена
    if (!organizationId) {
      logger.warn('[listChats] organizationId не определен в res.locals.');
      return res.status(400).json({ error: 'organizationId обязателен' });
    }

    // Получаем чаты с датой последнего сообщения и сортируем по ней
    const chats = await chatService.getChatsByOrganizationSortedByLastMessage(organizationId);
    res.json(chats);
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
      orderBy: {
        timestamp: 'asc', // Сортируем по возрастанию времени для хронологического порядка
      },
      // Явно выбираем все поля, чтобы убедиться, что новые данные (ответы, медиа) включены
      select: {
        id: true,
        organizationId: true,
        organizationPhoneId: true,
        chatId: true,
        whatsappMessageId: true,
        receivingPhoneJid: true,
        remoteJid: true,
        senderJid: true,
        fromMe: true,
        content: true,
        type: true,
        mediaUrl: true,
        filename: true,
        mimeType: true,
        size: true,
        timestamp: true,
        status: true,
        quotedMessageId: true,
        quotedContent: true,
        createdAt: true,
        updatedAt: true,
      }
    });

    logger.info(`[getChatMessages] Успешно получено ${messages.length} сообщений для чата ${chatId} организации ${organizationId}.`);
    res.status(200).json({ messages });
  } catch (error: any) {
    logger.error(`[getChatMessages] Ошибка при получении сообщений для чата ${chatId} организации ${organizationId}:`, error);
    res.status(500).json({
      error: 'Не удалось получить сообщения чата.',
      details: error.message,
    });
  }
};