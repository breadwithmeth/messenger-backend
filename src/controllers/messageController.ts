// src/controllers/messageController.ts

import { Request, Response } from 'express';
import { getBaileysSock, sendMessage } from '../config/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import pino from 'pino';
import { prisma } from '../config/authStorage'; // Для получения phoneJid
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

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

/**
 * Универсальный эндпоинт для отправки сообщений по chatId
 * Автоматически определяет тип подключения (Baileys или WABA) и использует соответствующий сервис
 * POST /api/messages/send-by-chat
 */
export const sendMessageByChat = async (req: Request, res: Response) => {
  try {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const { chatId, text, type = 'text', mediaUrl, caption, filename, template } = req.body;

    // Валидация
    if (!chatId || isNaN(parseInt(chatId))) {
      logger.warn(`[sendMessageByChat] Некорректный chatId: "${chatId}". Ожидалось число.`);
      return res.status(400).json({ error: 'Некорректный chatId. Ожидалось число.' });
    }

    if (type === 'text' && (!text || typeof text !== 'string' || text.trim() === '')) {
      logger.warn('[sendMessageByChat] Отсутствует или пустой параметр text для типа text.');
      return res.status(400).json({ error: 'Параметр text обязателен для типа text.' });
    }

    if ((type === 'image' || type === 'document' || type === 'video' || type === 'audio') && !mediaUrl) {
      logger.warn(`[sendMessageByChat] Отсутствует mediaUrl для типа ${type}.`);
      return res.status(400).json({ error: `Параметр mediaUrl обязателен для типа ${type}.` });
    }

    if (type === 'template' && (!template || !template.name)) {
      logger.warn('[sendMessageByChat] Отсутствует template объект для типа template.');
      return res.status(400).json({ error: 'Параметр template с полем name обязателен для типа template.' });
    }

    // Находим чат с информацией о типе подключения и канале
    const chat = await prisma.chat.findFirst({
      where: {
        id: parseInt(chatId),
        organizationId: organizationId,
      },
      include: {
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
            connectionType: true,
            wabaAccessToken: true,
            wabaPhoneNumberId: true,
          },
        },
        telegramBot: {
          select: {
            id: true,
            botUsername: true,
          },
        },
      },
    });

    if (!chat) {
      logger.warn(`[sendMessageByChat] Чат с ID ${chatId} не найден или не принадлежит организации ${organizationId}.`);
      return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
    }

    const channel = chat.channel;
    let sentMessage: any;
    let messageContent = '';

    // Определяем метод отправки в зависимости от канала
    if (channel === 'telegram') {
      // Используем Telegram Bot API
      logger.info(`[sendMessageByChat] Используем Telegram для чата ${chatId}`);

      if (!chat.telegramBot || !chat.telegramChatId) {
        logger.error(`[sendMessageByChat] У чата ${chatId} отсутствует telegramBot или telegramChatId.`);
        return res.status(500).json({ error: 'У чата отсутствует привязка к Telegram боту.' });
      }

      const { 
        sendTelegramMessage,
        sendTelegramPhoto,
        sendTelegramDocument,
        sendTelegramVideo,
        sendTelegramAudio,
      } = await import('../services/telegramService');

      try {
        // Обработка разных типов сообщений
        if (type === 'text') {
          sentMessage = await sendTelegramMessage(
            chat.telegramBot.id,
            chat.telegramChatId,
            text,
            { userId }
          );
        } else if (type === 'image') {
          if (!mediaUrl) {
            return res.status(400).json({ error: 'Отсутствует mediaUrl для изображения' });
          }
          sentMessage = await sendTelegramPhoto(
            chat.telegramBot.id,
            chat.telegramChatId,
            mediaUrl,
            text || caption,
            { userId }
          );
        } else if (type === 'document') {
          if (!mediaUrl) {
            return res.status(400).json({ error: 'Отсутствует mediaUrl для документа' });
          }
          sentMessage = await sendTelegramDocument(
            chat.telegramBot.id,
            chat.telegramChatId,
            mediaUrl,
            text || caption,
            { userId, filename }
          );
        } else if (type === 'video') {
          if (!mediaUrl) {
            return res.status(400).json({ error: 'Отсутствует mediaUrl для видео' });
          }
          sentMessage = await sendTelegramVideo(
            chat.telegramBot.id,
            chat.telegramChatId,
            mediaUrl,
            text || caption,
            { userId }
          );
        } else if (type === 'audio') {
          if (!mediaUrl) {
            return res.status(400).json({ error: 'Отсутствует mediaUrl для аудио' });
          }
          sentMessage = await sendTelegramAudio(
            chat.telegramBot.id,
            chat.telegramChatId,
            mediaUrl,
            text || caption,
            { userId }
          );
        } else {
          return res.status(400).json({ 
            error: `Тип ${type} не поддерживается для Telegram. Поддерживаются: text, image, document, video, audio` 
          });
        }

        logger.info(`[sendMessageByChat] Telegram сообщение (${type}) отправлено в чат ${chatId}, messageId: ${sentMessage.message_id}`);
        
        return res.status(200).json({
          success: true,
          messageId: sentMessage.message_id,
          chatId: chat.id,
          channel: 'telegram',
          type,
        });
      } catch (error: any) {
        logger.error(`[sendMessageByChat] Ошибка отправки Telegram сообщения:`, error);
        return res.status(500).json({ 
          error: 'Не удалось отправить сообщение через Telegram.', 
          details: error.message 
        });
      }

    } else if (channel === 'whatsapp') {
      // WhatsApp: определяем тип подключения (Baileys или WABA)
      if (!chat.organizationPhone) {
        logger.error(`[sendMessageByChat] У чата ${chatId} отсутствует organizationPhone.`);
        return res.status(500).json({ error: 'У чата отсутствует привязка к телефону организации.' });
      }

      const connectionType = chat.organizationPhone.connectionType || 'baileys';

      if (connectionType === 'waba') {
      // Используем WABA API
      logger.info(`[sendMessageByChat] Используем WABA для чата ${chatId}`);
      
      const { createWABAService } = await import('../services/wabaService');
      const wabaService = await createWABAService(chat.organizationPhone.id);
      
      if (!wabaService) {
        logger.error(`[sendMessageByChat] WABA сервис не настроен для organizationPhoneId ${chat.organizationPhone.id}`);
        return res.status(500).json({ error: 'WABA сервис не настроен для этого телефона.' });
      }

      const recipientPhone = chat.remoteJid.replace('@s.whatsapp.net', '');

      // Отправляем через WABA в зависимости от типа
      switch (type) {
        case 'text':
          sentMessage = await wabaService.sendTextMessage(recipientPhone, text);
          messageContent = text;
          break;
        
        case 'image':
          sentMessage = await wabaService.sendImage(recipientPhone, mediaUrl, caption);
          messageContent = caption || '[Image]';
          break;
        
        case 'document':
          sentMessage = await wabaService.sendDocument(recipientPhone, mediaUrl, filename, caption);
          messageContent = caption || `[Document: ${filename || 'file'}]`;
          break;
        
        case 'video':
          sentMessage = await wabaService.sendMessage({
            to: recipientPhone,
            type: 'video',
            video: { link: mediaUrl, caption }
          });
          messageContent = caption || '[Video]';
          break;
        
        case 'audio':
          sentMessage = await wabaService.sendMessage({
            to: recipientPhone,
            type: 'audio',
            audio: { link: mediaUrl }
          });
          messageContent = '[Audio]';
          break;
        
        case 'template':
          sentMessage = await wabaService.sendTemplateMessage(
            recipientPhone,
            template.name,
            template.language || 'ru',
            template.components
          );
          messageContent = `Template: ${template.name}`;
          break;
        
        default:
          return res.status(400).json({ error: `Неподдерживаемый тип сообщения: ${type}` });
      }

      // Сохраняем сообщение в БД
      const savedMessage = await prisma.message.create({
        data: {
          chatId: chat.id,
          organizationPhoneId: chat.organizationPhone.id,
          organizationId: chat.organizationId,
          channel: 'whatsapp',
          whatsappMessageId: sentMessage.messages?.[0]?.id,
          receivingPhoneJid: chat.organizationPhone.phoneJid,
          remoteJid: chat.remoteJid,
          senderJid: chat.organizationPhone.phoneJid,
          fromMe: true,
          content: messageContent,
          mediaUrl: mediaUrl || null,
          type: type,
          timestamp: new Date(),
          status: 'sent',
          senderUserId: userId,
          isReadByOperator: true,
        },
      });

      // Обновляем lastMessageAt
      await prisma.chat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });

      logger.info(`[sendMessageByChat] WABA сообщение отправлено в чат ${chatId}, messageId: ${sentMessage.messages?.[0]?.id}`);

      // Отправляем Socket.IO уведомление о новом сообщении от оператора
      const { notifyNewMessage } = await import('../services/socketService');
      try {
        notifyNewMessage(organizationId, {
          id: savedMessage.id,
          chatId: savedMessage.chatId,
          content: savedMessage.content,
          type: savedMessage.type,
          mediaUrl: savedMessage.mediaUrl,
          filename: savedMessage.filename,
          fromMe: true,
          timestamp: savedMessage.timestamp,
          status: savedMessage.status,
          senderUserId: userId,
          channel: 'whatsapp',
        });
      } catch (socketError) {
        logger.error('[Socket.IO] Ошибка отправки уведомления:', socketError);
      }
      
      return res.status(200).json({
        success: true,
        messageId: sentMessage.messages?.[0]?.id,
        chatId: chat.id,
        channel: 'whatsapp',
        connectionType: 'waba',
        message: savedMessage,
      });

    } else {
      // Используем Baileys
      logger.info(`[sendMessageByChat] Используем Baileys для чата ${chatId}`);
      
      const sock = getBaileysSock(chat.organizationPhone.id);

      if (!sock || !sock.user) {
        logger.warn(`[sendMessageByChat] Baileys сокет для organizationPhoneId ${chat.organizationPhone.id} не готов.`);
        return res.status(503).json({
          error: 'WhatsApp аккаунт не готов к отправке сообщений. Попробуйте позже.',
          details: 'Socket not ready or user not authenticated.'
        });
      }

      const normalizedReceiverJid = jidNormalizedUser(chat.remoteJid);

      if (!normalizedReceiverJid) {
        logger.error(`[sendMessageByChat] Некорректный remoteJid: "${chat.remoteJid}".`);
        return res.status(500).json({ error: 'Некорректный remoteJid в базе данных.' });
      }

      // Для Baileys поддерживаем text и media (не template)
      let messageContentObj: any;
      let savedMediaPath: string | undefined;

      switch (type) {
        case 'text':
          messageContentObj = { text };
          break;
        
        case 'image':
        case 'document':
        case 'video':
        case 'audio': {
          if (!mediaUrl) {
            return res.status(400).json({ 
              error: `Отсутствует mediaUrl для типа ${type}.` 
            });
          }

          try {
            // Скачиваем медиафайл
            logger.info(`[sendMessageByChat] Скачиваем медиа для Baileys: ${type} - ${mediaUrl}`);
            
            const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            // Создаем объект контента для Baileys в зависимости от типа
            const mediaContent: any = {
              caption: caption || text || '',
            };

            if (type === 'image') {
              mediaContent.image = buffer;
              messageContentObj = mediaContent;
            } else if (type === 'video') {
              mediaContent.video = buffer;
              messageContentObj = mediaContent;
            } else if (type === 'audio') {
              mediaContent.audio = buffer;
              mediaContent.mimetype = 'audio/ogg; codecs=opus';
              messageContentObj = mediaContent;
            } else if (type === 'document') {
              mediaContent.document = buffer;
              mediaContent.fileName = filename || 'document';
              mediaContent.mimetype = 'application/octet-stream';
              messageContentObj = mediaContent;
            }

            // Сохраняем информацию о медиа для последующей записи в БД
            savedMediaPath = mediaUrl;

          } catch (error: any) {
            logger.error(`[sendMessageByChat] Ошибка при скачивании медиа:`, error.message);
            return res.status(500).json({ 
              error: `Не удалось скачать медиафайл: ${error.message}` 
            });
          }
          break;
        }
        
        case 'template':
          return res.status(400).json({ 
            error: 'Шаблоны не поддерживаются для Baileys подключений. Используйте только WABA.' 
          });
        
        default:
          return res.status(400).json({ error: `Неподдерживаемый тип сообщения: ${type}` });
      }

      sentMessage = await sendMessage(
        sock,
        normalizedReceiverJid,
        messageContentObj,
        organizationId,
        chat.organizationPhone.id,
        chat.organizationPhone.phoneJid,
        userId,
        {
          mediaUrl: savedMediaPath,
          filename: filename,
        }
      );

      if (!sentMessage) {
        logger.error(`[sendMessageByChat] Baileys сообщение не было отправлено для чата ${chatId}.`);
        return res.status(500).json({ error: 'Не удалось отправить сообщение.' });
      }

      logger.info(`[sendMessageByChat] Baileys сообщение отправлено в чат ${chatId}, messageId: ${sentMessage.key.id}`);

      // Socket.IO уведомление отправляется автоматически в baileys.ts через sendMessage()
      // Дополнительное уведомление не требуется, так как baileys.ts уже обрабатывает это
      
      return res.status(200).json({
        success: true,
        messageId: sentMessage.key.id,
        chatId: chat.id,
        channel: 'whatsapp',
        connectionType: 'baileys',
      });
      }
    } else {
      // Неизвестный канал
      logger.error(`[sendMessageByChat] Неподдерживаемый канал: ${channel}`);
      return res.status(400).json({ error: `Неподдерживаемый канал: ${channel}` });
    }

  } catch (error: any) {
    logger.error(`[sendMessageByChat] Ошибка при отправке сообщения:`, error);
    res.status(500).json({
      error: 'Не удалось отправить сообщение.',
      details: error.message,
    });
  }
};