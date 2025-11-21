// src/controllers/messageController.ts

import { Request, Response } from 'express';
import { getBaileysSock, sendMessage } from '../config/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import { prisma } from '../config/authStorage'; // Для получения phoneJid

const logger = pino({ level: 'info' });

export const sendTextMessage = async (req: Request, res: Response) => {
  const { organizationPhoneId, receiverJid, text } = req.body;
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId; // <--- ПОЛУЧАЕМ ID ПОЛЬЗОВАТЕЛЯ

  // 1. Валидация входных данных
  if (!organizationPhoneId || !receiverJid || !text) {
    logger.warn('[sendTextMessage] Отсутствуют необходимые параметры: organizationPhoneId, receiverJid или text.');
    return res.status(400).json({ error: 'Missing organizationPhoneId, receiverJid, or text' });
  }

  // 2. Нормализация JID получателя
  // jidNormalizedUser может вернуть null, если JID невалидный.
  const normalizedReceiverJid = jidNormalizedUser(receiverJid);

  // --- НОВОЕ ИЗМЕНЕНИЕ: Проверка, что JID успешно нормализован ---
  if (!normalizedReceiverJid) {
    logger.error(`[sendTextMessage] Некорректный или ненормализуемый receiverJid: "${receiverJid}".`);
    return res.status(400).json({ error: 'Invalid receiverJid provided. Could not normalize WhatsApp ID.' });
  }
  // --- КОНЕЦ НОВОГО ИЗМЕНЕНИЯ ---

  // 3. Получение Baileys сокета
  const sock = getBaileysSock(organizationPhoneId);

  // 4. Проверка готовности сокета
  // Сокет готов к отправке, если он существует и успешно аутентифицирован (имеет объект user).
  if (!sock || !sock.user) {
    logger.warn(`[sendTextMessage] Попытка отправить сообщение, но сокет для ID ${organizationPhoneId} не готов (пользователь не авторизован или сокет отсутствует).`);
    const status = sock ? 'connecting/closed' : 'not found';
    return res.status(503).json({ 
      error: `WhatsApp аккаунт (ID: ${organizationPhoneId}) еще не полностью подключен или не готов к отправке сообщений. Текущий статус: ${status}. Попробуйте позже.`,
      details: 'Socket not ready or user not authenticated.'
    });
  }
  const organizationPhone = await prisma.organizationPhone.findUnique({
      where: { id: organizationPhoneId, organizationId: organizationId },
      select: { phoneJid: true }
  });

  if (!organizationPhone || !organizationPhone.phoneJid) {
      logger.error(`[sendTextMessage] Не удалось найти phoneJid для organizationPhoneId: ${organizationPhoneId} или он пуст.`);
      return res.status(404).json({ error: 'Sender WhatsApp account not found or not configured.' });
  }
  const senderJid = organizationPhone.phoneJid;
  // 5. Попытка отправить сообщение
  try {
    const sentMessage = await sendMessage(
      sock,
      normalizedReceiverJid,
      { text },
      organizationId,
      organizationPhoneId,
      senderJid,
      userId // <--- ПЕРЕДАЕМ ID ПОЛЬЗОВАТЕЛЯ
    );

    // 6. Проверка, что sentMessage не undefined
    // sock.sendMessage() может вернуть undefined в некоторых случаях, даже без выбрасывания ошибки.
    if (!sentMessage) {
      logger.error(`❌ Сообщение не было отправлено (sentMessage is undefined) на ${normalizedReceiverJid} с ID ${organizationPhoneId}.`);
      return res.status(500).json({ error: 'Failed to send message: WhatsApp API did not return a message object.', details: 'The message might not have been sent successfully.' });
    }

    // 7. Успешная отправка
    logger.info(`✅ Сообщение "${text}" отправлено на ${normalizedReceiverJid} с ID ${organizationPhoneId}. WhatsApp Message ID: ${sentMessage.key.id}`);
    return res.status(200).json({ success: true, messageId: sentMessage.key.id });

  } catch (error: any) {
    // 8. Обработка ошибок отправки
    logger.error(`❌ Критическая ошибка при отправке сообщения на ${normalizedReceiverJid} с ID ${organizationPhoneId}:`, error);
    return res.status(500).json({ error: 'Failed to send message due to an internal error.', details: error.message });
  }
};

/**
 * Отправляет медиафайл (изображение, видео, документ, аудио)
 */
export const sendMediaMessage = async (req: Request, res: Response) => {
  const { organizationPhoneId, receiverJid, mediaType, mediaPath, caption, filename } = req.body;
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;

  // 1. Валидация входных данных
  if (!organizationPhoneId || !receiverJid || !mediaType || !mediaPath) {
    logger.warn('[sendMediaMessage] Отсутствуют необходимые параметры: organizationPhoneId, receiverJid, mediaType или mediaPath.');
    return res.status(400).json({ error: 'Missing organizationPhoneId, receiverJid, mediaType, or mediaPath' });
  }

  // 2. Проверка типа медиа
  const allowedMediaTypes = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    logger.warn(`[sendMediaMessage] Неподдерживаемый тип медиа: "${mediaType}"`);
    return res.status(400).json({ error: `Unsupported media type. Allowed types: ${allowedMediaTypes.join(', ')}` });
  }

  // 3. Нормализация JID получателя
  const normalizedReceiverJid = jidNormalizedUser(receiverJid);
  if (!normalizedReceiverJid) {
    logger.error(`[sendMediaMessage] Некорректный или ненормализуемый receiverJid: "${receiverJid}".`);
    return res.status(400).json({ error: 'Invalid receiverJid provided. Could not normalize WhatsApp ID.' });
  }

  // 4. Получение Baileys сокета
  const sock = getBaileysSock(organizationPhoneId);
  if (!sock || !sock.user) {
    logger.warn(`[sendMediaMessage] Попытка отправить медиа, но сокет для ID ${organizationPhoneId} не готов.`);
    const status = sock ? 'connecting/closed' : 'not found';
    return res.status(503).json({ 
      error: `WhatsApp аккаунт (ID: ${organizationPhoneId}) еще не полностью подключен. Текущий статус: ${status}. Попробуйте позже.`,
    });
  }

  // 5. Получение информации об отправителе
  const organizationPhone = await prisma.organizationPhone.findUnique({
    where: { id: organizationPhoneId, organizationId: organizationId },
    select: { phoneJid: true }
  });

  if (!organizationPhone || !organizationPhone.phoneJid) {
    logger.error(`[sendMediaMessage] Не удалось найти phoneJid для organizationPhoneId: ${organizationPhoneId}`);
    return res.status(404).json({ error: 'Sender WhatsApp account not found or not configured.' });
  }

  const senderJid = organizationPhone.phoneJid;

  try {
    // 6. Подготовка контента для отправки
    let messageContent: any;

    // Проверяем, является ли mediaPath URL или локальным путем
    const isUrl = mediaPath.startsWith('http://') || mediaPath.startsWith('https://');
    
    if (isUrl) {
      // Если это URL, отправляем как ссылку
      switch (mediaType) {
        case 'image':
          messageContent = {
            image: { url: mediaPath },
            caption: caption || '',
          };
          break;
        case 'video':
          messageContent = {
            video: { url: mediaPath },
            caption: caption || '',
          };
          break;
        case 'document':
          messageContent = {
            document: { url: mediaPath },
            fileName: filename || 'document',
            caption: caption || '',
          };
          break;
        case 'audio':
          messageContent = {
            audio: { url: mediaPath },
            mimetype: 'audio/mp4', // или другой подходящий MIME тип
          };
          break;
      }
    } else {
      // Если это локальный путь, читаем файл
      const fs = require('fs');
      const path = require('path');
      
      // Определяем полный путь к файлу
      const fullPath = path.isAbsolute(mediaPath) ? mediaPath : path.join(process.cwd(), mediaPath);
      
      // Проверяем существование файла
      if (!fs.existsSync(fullPath)) {
        logger.error(`[sendMediaMessage] Файл не найден: ${fullPath}`);
        return res.status(404).json({ error: 'Media file not found' });
      }

      // Читаем файл
      const fileBuffer = fs.readFileSync(fullPath);
      
      switch (mediaType) {
        case 'image':
          messageContent = {
            image: fileBuffer,
            caption: caption || '',
          };
          break;
        case 'video':
          messageContent = {
            video: fileBuffer,
            caption: caption || '',
          };
          break;
        case 'document':
          messageContent = {
            document: fileBuffer,
            fileName: filename || path.basename(fullPath),
            caption: caption || '',
          };
          break;
        case 'audio':
          messageContent = {
            audio: fileBuffer,
            mimetype: 'audio/mp4',
          };
          break;
      }
    }

    // 7. Отправка медиафайла
    const sentMessage = await sendMessage(
      sock,
      normalizedReceiverJid,
      messageContent,
      organizationId,
      organizationPhoneId,
      senderJid,
      userId
    );

    if (!sentMessage) {
      logger.error(`❌ Медиафайл не был отправлен (sentMessage is undefined) на ${normalizedReceiverJid}`);
      return res.status(500).json({ error: 'Failed to send media: WhatsApp API did not return a message object.' });
    }

    // 8. Успешная отправка
    logger.info(`✅ Медиафайл типа "${mediaType}" отправлен на ${normalizedReceiverJid} с ID ${organizationPhoneId}. WhatsApp Message ID: ${sentMessage.key.id}`);
    return res.status(200).json({ 
      success: true, 
      messageId: sentMessage.key.id,
      mediaType: mediaType,
      caption: caption || null,
    });

  } catch (error: any) {
    logger.error(`❌ Критическая ошибка при отправке медиафайла на ${normalizedReceiverJid}:`, error);
    return res.status(500).json({ error: 'Failed to send media due to an internal error.', details: error.message });
  }
};

/**
 * Отправить текстовое сообщение по номеру тикета
 */
export const sendMessageByTicket = async (req: Request, res: Response) => {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { ticketNumber, text } = req.body;

    // Валидация
    if (!organizationId) {
      logger.warn('[sendMessageByTicket] Несанкционированный доступ: organizationId не определен в res.locals.');
      return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
    }

    if (!ticketNumber || isNaN(parseInt(ticketNumber))) {
      logger.warn(`[sendMessageByTicket] Некорректный ticketNumber: "${ticketNumber}". Ожидалось число.`);
      return res.status(400).json({ error: 'Некорректный ticketNumber. Ожидалось число.' });
    }

    if (!text || typeof text !== 'string' || text.trim() === '') {
      logger.warn('[sendMessageByTicket] Отсутствует или пустой параметр text.');
      return res.status(400).json({ error: 'Параметр text обязателен и не должен быть пустым.' });
    }

    // Находим чат по ticketNumber
    const chat = await prisma.chat.findFirst({
      where: {
        ticketNumber: parseInt(ticketNumber),
        organizationId: organizationId,
      },
      select: {
        id: true,
        remoteJid: true,
        receivingPhoneJid: true,
        organizationPhoneId: true,
      },
    });

    if (!chat) {
      logger.warn(`[sendMessageByTicket] Тикет с номером ${ticketNumber} не найден или не принадлежит организации ${organizationId}.`);
      return res.status(404).json({ error: 'Тикет не найден или не принадлежит вашей организации.' });
    }

    if (!chat.remoteJid || !chat.receivingPhoneJid || !chat.organizationPhoneId) {
      logger.error(`[sendMessageByTicket] У тикета ${ticketNumber} отсутствуют необходимые данные (remoteJid, receivingPhoneJid или organizationPhoneId).`);
      return res.status(500).json({ error: 'У тикета отсутствуют необходимые данные для отправки сообщения.' });
    }

    // Получаем сокет Baileys
    const sock = getBaileysSock(chat.organizationPhoneId);

    if (!sock || !sock.user) {
      logger.warn(`[sendMessageByTicket] Сокет для organizationPhoneId ${chat.organizationPhoneId} не готов.`);
      return res.status(503).json({
        error: `WhatsApp аккаунт не готов к отправке сообщений. Попробуйте позже.`,
        details: 'Socket not ready or user not authenticated.'
      });
    }

    // Нормализуем JID получателя
    const normalizedReceiverJid = jidNormalizedUser(chat.remoteJid);

    if (!normalizedReceiverJid) {
      logger.error(`[sendMessageByTicket] Некорректный remoteJid: "${chat.remoteJid}".`);
      return res.status(500).json({ error: 'Некорректный remoteJid в базе данных.' });
    }

    // Отправляем сообщение
    const sentMessage = await sendMessage(
      sock,
      normalizedReceiverJid,
      { text },
      organizationId,
      chat.organizationPhoneId,
      chat.receivingPhoneJid,
      userId
    );

    if (!sentMessage) {
      logger.error(`[sendMessageByTicket] Сообщение не было отправлено (sentMessage is undefined) для тикета ${ticketNumber}.`);
      return res.status(500).json({ error: 'Не удалось отправить сообщение.', details: 'The message might not have been sent successfully.' });
    }

    logger.info(`[sendMessageByTicket] Сообщение отправлено в тикет ${ticketNumber}. WhatsApp Message ID: ${sentMessage.key.id}`);
    res.status(200).json({ success: true, messageId: sentMessage.key.id, ticketNumber: parseInt(ticketNumber) });

  } catch (error: any) {
    logger.error(`[sendMessageByTicket] Ошибка при отправке сообщения в тикет:`, error);
    res.status(500).json({
      error: 'Не удалось отправить сообщение в тикет.',
      details: error.message,
    });
  }
};