// src/controllers/messageController.ts

import { Request, Response } from 'express';
import { getBaileysSock, sendMessage } from '../config/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { createLogger } from '../config/logging';
import { prisma } from '../config/authStorage'; // Для получения phoneJid
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';
import { chatVisibilityWhere, userCanAccessHrChats } from '../auth/hrAccess';

const logger = createLogger();
const SENSITIVE_LOG_KEY = /(authorization|cookie|password|secret|token)/i;
const REDACTED_LOG_VALUE = '[REDACTED]';
const WABA_SEND_RETRY_DELAYS_MS = [750, 2000];
const WABA_SEND_MAX_ATTEMPTS = WABA_SEND_RETRY_DELAYS_MS.length + 1;

function consoleSendLog(scope: string, event: string, data: Record<string, unknown> = {}) {
  try {
    console.log(`[${scope}]`, JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }));
  } catch (error) {
    console.log(`[${scope} LOG ERROR]`, String(error));
  }
}

function redactForConsoleLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactForConsoleLog(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
      key,
      SENSITIVE_LOG_KEY.test(key) ? REDACTED_LOG_VALUE : redactForConsoleLog(childValue),
    ])
  );
}

function getHttpStatusFromUpstreamError(error: any): number {
  const upstreamStatus = Number(error?.response?.status);

  if (!Number.isInteger(upstreamStatus)) return 500;
  if (upstreamStatus >= 500) return 503;
  if (upstreamStatus >= 400) return upstreamStatus;
  return 500;
}

function isRetriableWabaSendError(error: any): boolean {
  const responseStatus = Number(error?.response?.status);
  const graphError = error?.response?.data?.error;

  return (
    graphError?.is_transient === true ||
    graphError?.code === 2 ||
    responseStatus === 429 ||
    responseStatus >= 500
  );
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getAxiosErrorSnapshot(error: any): Record<string, unknown> {
  const responseData = error?.response?.data;
  const graphError = responseData?.error;

  return {
    errorMessage: graphError?.message || error?.message,
    errorCode: error?.code,
    responseStatus: error?.response?.status,
    responseStatusText: error?.response?.statusText,
    graphErrorCode: graphError?.code,
    graphErrorSubcode: graphError?.error_subcode,
    graphErrorType: graphError?.type,
    graphErrorFbtraceId: graphError?.fbtrace_id,
    graphErrorIsTransient: graphError?.is_transient,
    responseData: redactForConsoleLog(responseData),
  };
}

function getSocketSnapshot(sock: any) {
  return {
    hasSock: Boolean(sock),
    hasUser: Boolean(sock?.user),
    sockUserId: sock?.user?.id,
    wsState: sock?.ws?.readyState,
  };
}

async function canUseExistingChatByJid(
  organizationId: number,
  organizationPhoneId: unknown,
  receiverJid: string,
  normalizedReceiverJid: string,
  canAccessHrChats: boolean
): Promise<boolean> {
  const parsedOrganizationPhoneId = Number.parseInt(String(organizationPhoneId), 10);
  if (!Number.isInteger(parsedOrganizationPhoneId)) return true;

  const existingChat = await prisma.chat.findFirst({
    where: {
      organizationId,
      organizationPhoneId: parsedOrganizationPhoneId,
      remoteJid: {
        in: Array.from(new Set([receiverJid, normalizedReceiverJid])),
      },
    },
    select: {
      isHr: true,
    },
  });

  return !existingChat?.isHr || canAccessHrChats;
}

export const sendTextMessage = async (req: Request, res: Response) => {
  const { organizationPhoneId, receiverJid, text } = req.body;
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId; // <--- ПОЛУЧАЕМ ID ПОЛЬЗОВАТЕЛЯ
  const canAccessHrChats = userCanAccessHrChats(res.locals);

  consoleSendLog('BAILEYS SEND', 'send-text-request', {
    organizationId,
    userId,
    organizationPhoneId,
    receiverJid,
    textLength: typeof text === 'string' ? text.length : null,
  });

  // 1. Валидация входных данных
  if (!organizationPhoneId || !receiverJid || !text) {
    logger.warn('[sendTextMessage] Отсутствуют необходимые параметры: organizationPhoneId, receiverJid или text.');
    consoleSendLog('BAILEYS SEND', 'send-text-validation-failed', {
      organizationPhoneId,
      hasReceiverJid: Boolean(receiverJid),
      hasText: Boolean(text),
    });
    return res.status(400).json({ error: 'Missing organizationPhoneId, receiverJid, or text' });
  }

  // 2. Нормализация JID получателя
  // jidNormalizedUser может вернуть null, если JID невалидный.
  const normalizedReceiverJid = jidNormalizedUser(receiverJid);

  // --- НОВОЕ ИЗМЕНЕНИЕ: Проверка, что JID успешно нормализован ---
  if (!normalizedReceiverJid) {
    logger.error(`[sendTextMessage] Некорректный или ненормализуемый receiverJid: "${receiverJid}".`);
    consoleSendLog('BAILEYS SEND', 'send-text-invalid-receiver', { receiverJid });
    return res.status(400).json({ error: 'Invalid receiverJid provided. Could not normalize WhatsApp ID.' });
  }
  // --- КОНЕЦ НОВОГО ИЗМЕНЕНИЯ ---

  if (
    organizationId &&
    !(await canUseExistingChatByJid(organizationId, organizationPhoneId, receiverJid, normalizedReceiverJid, canAccessHrChats))
  ) {
    return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
  }

  // 3. Получение Baileys сокета
  const sock = getBaileysSock(organizationPhoneId);
  consoleSendLog('BAILEYS SEND', 'send-text-socket-check', {
    organizationPhoneId,
    normalizedReceiverJid,
    ...getSocketSnapshot(sock),
  });

  // 4. Проверка готовности сокета
  // Сокет готов к отправке, если он существует и успешно аутентифицирован (имеет объект user).
  if (!sock || !sock.user) {
    logger.warn(`[sendTextMessage] Попытка отправить сообщение, но сокет для ID ${organizationPhoneId} не готов (пользователь не авторизован или сокет отсутствует).`);
    const status = sock ? 'connecting/closed' : 'not found';
    consoleSendLog('BAILEYS SEND', 'send-text-socket-not-ready', {
      organizationPhoneId,
      status,
      ...getSocketSnapshot(sock),
    });
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
      consoleSendLog('BAILEYS SEND', 'send-text-sender-not-found', { organizationPhoneId });
      return res.status(404).json({ error: 'Sender WhatsApp account not found or not configured.' });
  }
  const senderJid = organizationPhone.phoneJid;
  // 5. Попытка отправить сообщение
  try {
    consoleSendLog('BAILEYS SEND', 'send-text-calling-baileys', {
      organizationId,
      organizationPhoneId,
      senderJid,
      normalizedReceiverJid,
    });

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
      consoleSendLog('BAILEYS SEND', 'send-text-result-empty', {
        organizationPhoneId,
        normalizedReceiverJid,
      });
      return res.status(500).json({ error: 'Failed to send message: WhatsApp API did not return a message object.', details: 'The message might not have been sent successfully.' });
    }

    // 7. Успешная отправка
    logger.info(`✅ Сообщение "${text}" отправлено на ${normalizedReceiverJid} с ID ${organizationPhoneId}. WhatsApp Message ID: ${sentMessage.key.id}`);
    consoleSendLog('BAILEYS SEND', 'send-text-success', {
      organizationPhoneId,
      normalizedReceiverJid,
      messageId: sentMessage.key.id,
    });
    return res.status(200).json({ success: true, messageId: sentMessage.key.id });

  } catch (error: any) {
    // 8. Обработка ошибок отправки
    logger.error(`❌ Критическая ошибка при отправке сообщения на ${normalizedReceiverJid} с ID ${organizationPhoneId}:`, error);
    consoleSendLog('BAILEYS SEND', 'send-text-error', {
      organizationPhoneId,
      normalizedReceiverJid,
      errorMessage: error?.message,
      errorCode: error?.code,
    });
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
  const canAccessHrChats = userCanAccessHrChats(res.locals);

  consoleSendLog('BAILEYS SEND', 'send-media-request', {
    organizationId,
    userId,
    organizationPhoneId,
    receiverJid,
    mediaType,
    hasMediaPath: Boolean(mediaPath),
    hasCaption: Boolean(caption),
    filename,
  });

  // 1. Валидация входных данных
  if (!organizationPhoneId || !receiverJid || !mediaType || !mediaPath) {
    logger.warn('[sendMediaMessage] Отсутствуют необходимые параметры: organizationPhoneId, receiverJid, mediaType или mediaPath.');
    consoleSendLog('BAILEYS SEND', 'send-media-validation-failed', {
      organizationPhoneId,
      hasReceiverJid: Boolean(receiverJid),
      mediaType,
      hasMediaPath: Boolean(mediaPath),
    });
    return res.status(400).json({ error: 'Missing organizationPhoneId, receiverJid, mediaType, or mediaPath' });
  }

  // 2. Проверка типа медиа
  const allowedMediaTypes = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    logger.warn(`[sendMediaMessage] Неподдерживаемый тип медиа: "${mediaType}"`);
    consoleSendLog('BAILEYS SEND', 'send-media-unsupported-type', { mediaType });
    return res.status(400).json({ error: `Unsupported media type. Allowed types: ${allowedMediaTypes.join(', ')}` });
  }

  // 3. Нормализация JID получателя
  const normalizedReceiverJid = jidNormalizedUser(receiverJid);
  if (!normalizedReceiverJid) {
    logger.error(`[sendMediaMessage] Некорректный или ненормализуемый receiverJid: "${receiverJid}".`);
    consoleSendLog('BAILEYS SEND', 'send-media-invalid-receiver', { receiverJid });
    return res.status(400).json({ error: 'Invalid receiverJid provided. Could not normalize WhatsApp ID.' });
  }

  if (
    organizationId &&
    !(await canUseExistingChatByJid(organizationId, organizationPhoneId, receiverJid, normalizedReceiverJid, canAccessHrChats))
  ) {
    return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
  }

  // 4. Получение Baileys сокета
  const sock = getBaileysSock(organizationPhoneId);
  consoleSendLog('BAILEYS SEND', 'send-media-socket-check', {
    organizationPhoneId,
    normalizedReceiverJid,
    ...getSocketSnapshot(sock),
  });
  if (!sock || !sock.user) {
    logger.warn(`[sendMediaMessage] Попытка отправить медиа, но сокет для ID ${organizationPhoneId} не готов.`);
    const status = sock ? 'connecting/closed' : 'not found';
    consoleSendLog('BAILEYS SEND', 'send-media-socket-not-ready', {
      organizationPhoneId,
      status,
      ...getSocketSnapshot(sock),
    });
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
    consoleSendLog('BAILEYS SEND', 'send-media-sender-not-found', { organizationPhoneId });
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
    consoleSendLog('BAILEYS SEND', 'send-media-calling-baileys', {
      organizationId,
      organizationPhoneId,
      senderJid,
      normalizedReceiverJid,
      mediaType,
    });

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
      consoleSendLog('BAILEYS SEND', 'send-media-result-empty', {
        organizationPhoneId,
        normalizedReceiverJid,
        mediaType,
      });
      return res.status(500).json({ error: 'Failed to send media: WhatsApp API did not return a message object.' });
    }

    // 8. Успешная отправка
    logger.info(`✅ Медиафайл типа "${mediaType}" отправлен на ${normalizedReceiverJid} с ID ${organizationPhoneId}. WhatsApp Message ID: ${sentMessage.key.id}`);
    consoleSendLog('BAILEYS SEND', 'send-media-success', {
      organizationPhoneId,
      normalizedReceiverJid,
      mediaType,
      messageId: sentMessage.key.id,
    });
    return res.status(200).json({ 
      success: true, 
      messageId: sentMessage.key.id,
      mediaType: mediaType,
      caption: caption || null,
    });

  } catch (error: any) {
    logger.error(`❌ Критическая ошибка при отправке медиафайла на ${normalizedReceiverJid}:`, error);
    consoleSendLog('BAILEYS SEND', 'send-media-error', {
      organizationPhoneId,
      normalizedReceiverJid,
      mediaType,
      errorMessage: error?.message,
      errorCode: error?.code,
    });
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
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    consoleSendLog('SEND-BY-TICKET', 'request', {
      organizationId,
      userId,
      ticketNumber,
      textLength: typeof text === 'string' ? text.length : null,
    });

    // Валидация
    if (!organizationId) {
      logger.warn('[sendMessageByTicket] Несанкционированный доступ: organizationId не определен в res.locals.');
      consoleSendLog('SEND-BY-TICKET', 'missing-organization', { userId, ticketNumber });
      return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
    }

    if (!ticketNumber || isNaN(parseInt(ticketNumber))) {
      logger.warn(`[sendMessageByTicket] Некорректный ticketNumber: "${ticketNumber}". Ожидалось число.`);
      consoleSendLog('SEND-BY-TICKET', 'invalid-ticket-number', { ticketNumber });
      return res.status(400).json({ error: 'Некорректный ticketNumber. Ожидалось число.' });
    }

    if (!text || typeof text !== 'string' || text.trim() === '') {
      logger.warn('[sendMessageByTicket] Отсутствует или пустой параметр text.');
      consoleSendLog('SEND-BY-TICKET', 'missing-text', {
        ticketNumber,
        textType: typeof text,
      });
      return res.status(400).json({ error: 'Параметр text обязателен и не должен быть пустым.' });
    }

    // Находим чат по ticketNumber
    const chat = await prisma.chat.findFirst({
      where: {
        ticketNumber: parseInt(ticketNumber),
        organizationId: organizationId,
        ...chatVisibilityWhere(canAccessHrChats),
      },
      select: {
        id: true,
        remoteJid: true,
        receivingPhoneJid: true,
        organizationPhoneId: true,
        assignedUserId: true,
        isHr: true,
      },
    });

    if (!chat) {
      logger.warn(`[sendMessageByTicket] Тикет с номером ${ticketNumber} не найден или не принадлежит организации ${organizationId}.`);
      consoleSendLog('SEND-BY-TICKET', 'chat-not-found', {
        organizationId,
        ticketNumber,
      });
      return res.status(404).json({ error: 'Тикет не найден или не принадлежит вашей организации.' });
    }

    if (!chat.assignedUserId) {
      logger.warn(`[sendMessageByTicket] Тикет ${ticketNumber} не назначен ответственному. Отправка запрещена.`);
      consoleSendLog('SEND-BY-TICKET', 'chat-not-assigned', {
        chatId: chat.id,
        ticketNumber,
      });
      return res.status(400).json({ error: 'Нельзя отправлять сообщения: тикет не назначен ответственному сотруднику.' });
    }

    if (!chat.remoteJid || !chat.receivingPhoneJid || !chat.organizationPhoneId) {
      logger.error(`[sendMessageByTicket] У тикета ${ticketNumber} отсутствуют необходимые данные (remoteJid, receivingPhoneJid или organizationPhoneId).`);
      consoleSendLog('SEND-BY-TICKET', 'chat-send-data-missing', {
        chatId: chat.id,
        ticketNumber,
        hasRemoteJid: Boolean(chat.remoteJid),
        hasReceivingPhoneJid: Boolean(chat.receivingPhoneJid),
        hasOrganizationPhoneId: Boolean(chat.organizationPhoneId),
      });
      return res.status(500).json({ error: 'У тикета отсутствуют необходимые данные для отправки сообщения.' });
    }

    // Получаем сокет Baileys
    const sock = getBaileysSock(chat.organizationPhoneId);
    consoleSendLog('SEND-BY-TICKET', 'baileys-socket-check', {
      organizationPhoneId: chat.organizationPhoneId,
      remoteJid: chat.remoteJid,
      ...getSocketSnapshot(sock),
    });

    if (!sock || !sock.user) {
      logger.warn(`[sendMessageByTicket] Сокет для organizationPhoneId ${chat.organizationPhoneId} не готов.`);
      consoleSendLog('SEND-BY-TICKET', 'baileys-socket-not-ready', {
        organizationPhoneId: chat.organizationPhoneId,
        ...getSocketSnapshot(sock),
      });
      return res.status(503).json({
        error: `WhatsApp аккаунт не готов к отправке сообщений. Попробуйте позже.`,
        details: 'Socket not ready or user not authenticated.'
      });
    }

    // Нормализуем JID получателя
    const normalizedReceiverJid = jidNormalizedUser(chat.remoteJid);

    if (!normalizedReceiverJid) {
      logger.error(`[sendMessageByTicket] Некорректный remoteJid: "${chat.remoteJid}".`);
      consoleSendLog('SEND-BY-TICKET', 'invalid-remote-jid', {
        chatId: chat.id,
        remoteJid: chat.remoteJid,
      });
      return res.status(500).json({ error: 'Некорректный remoteJid в базе данных.' });
    }

    // Отправляем сообщение
    consoleSendLog('SEND-BY-TICKET', 'baileys-calling-send', {
      chatId: chat.id,
      ticketNumber,
      organizationPhoneId: chat.organizationPhoneId,
      normalizedReceiverJid,
    });

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
      consoleSendLog('SEND-BY-TICKET', 'baileys-result-empty', {
        chatId: chat.id,
        ticketNumber,
        organizationPhoneId: chat.organizationPhoneId,
      });
      return res.status(500).json({ error: 'Не удалось отправить сообщение.', details: 'The message might not have been sent successfully.' });
    }

    logger.info(`[sendMessageByTicket] Сообщение отправлено в тикет ${ticketNumber}. WhatsApp Message ID: ${sentMessage.key.id}`);
    consoleSendLog('SEND-BY-TICKET', 'success', {
      chatId: chat.id,
      ticketNumber,
      organizationPhoneId: chat.organizationPhoneId,
      messageId: sentMessage.key.id,
    });
    res.status(200).json({ success: true, messageId: sentMessage.key.id, ticketNumber: parseInt(ticketNumber) });

  } catch (error: any) {
    logger.error(`[sendMessageByTicket] Ошибка при отправке сообщения в тикет:`, error);
    consoleSendLog('SEND-BY-TICKET', 'error', {
      ticketNumber: req.body.ticketNumber,
      errorMessage: error?.message,
      errorCode: error?.code,
    });
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
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    consoleSendLog('SEND-BY-CHAT', 'request', {
      organizationId,
      userId,
      chatId,
      type,
      hasText: Boolean(text),
      textLength: typeof text === 'string' ? text.length : null,
      hasMediaUrl: Boolean(mediaUrl),
      hasCaption: Boolean(caption),
      filename,
      hasTemplate: Boolean(template),
    });

    logger.info(`[sendMessageByChat] Начало обработки запроса`, {
      chatId,
      type,
      organizationId,
      userId,
      hasMediaUrl: !!mediaUrl,
      hasText: !!text,
    });

    // Валидация
    if (!chatId || isNaN(parseInt(chatId))) {
      logger.error(`[sendMessageByChat] ОШИБКА ВАЛИДАЦИИ: Некорректный chatId: "${chatId}". Ожидалось число.`, {
        providedChatId: chatId,
        type: typeof chatId,
      });
      consoleSendLog('SEND-BY-CHAT', 'invalid-chat-id', {
        chatId,
        chatIdType: typeof chatId,
      });
      return res.status(400).json({ error: 'Некорректный chatId. Ожидалось число.' });
    }

    if (type === 'text' && (!text || typeof text !== 'string' || text.trim() === '')) {
      logger.error(`[sendMessageByChat] ОШИБКА ВАЛИДАЦИИ: Отсутствует или пустой параметр text для типа text.`, {
        providedText: text,
        type: typeof text,
      });
      consoleSendLog('SEND-BY-CHAT', 'missing-text', {
        chatId,
        textType: typeof text,
      });
      return res.status(400).json({ error: 'Параметр text обязателен для типа text.' });
    }

    if ((type === 'image' || type === 'document' || type === 'video' || type === 'audio') && !mediaUrl) {
      logger.error(`[sendMessageByChat] ОШИБКА ВАЛИДАЦИИ: Отсутствует mediaUrl для типа ${type}.`, {
        requestedType: type,
        providedMediaUrl: mediaUrl,
      });
      consoleSendLog('SEND-BY-CHAT', 'missing-media-url', {
        chatId,
        type,
      });
      return res.status(400).json({ error: `Параметр mediaUrl обязателен для типа ${type}.` });
    }

    if (type === 'template' && (!template || !template.name)) {
      logger.error(`[sendMessageByChat] ОШИБКА ВАЛИДАЦИИ: Отсутствует template объект для типа template.`, {
        providedTemplate: template,
      });
      consoleSendLog('SEND-BY-CHAT', 'missing-template', {
        chatId,
        type,
      });
      return res.status(400).json({ error: 'Параметр template с полем name обязателен для типа template.' });
    }

    // Находим чат с информацией о типе подключения и канале
    const chat = await prisma.chat.findFirst({
      where: {
        id: parseInt(chatId),
        organizationId: organizationId,
        ...chatVisibilityWhere(canAccessHrChats),
      },
      include: {
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
            connectionType: true,
            wabaAccessToken: true,
            wabaPhoneNumberId: true,
            wabaId: true,
            wabaApiVersion: true,
          },
        },
        telegramBot: {
          select: {
            id: true,
            botUsername: true,
            botName: true,
          },
        },
        websiteSession: {
          select: {
            id: true,
          },
        },
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!chat) {
      logger.error(`[sendMessageByChat] ОШИБКА БД: Чат с ID ${chatId} не найден или не принадлежит организации ${organizationId}.`, {
        chatId: parseInt(chatId),
        organizationId,
      });
      consoleSendLog('SEND-BY-CHAT', 'chat-not-found', {
        organizationId,
        chatId: parseInt(chatId),
      });
      return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
    }

    consoleSendLog('SEND-BY-CHAT', 'chat-loaded', {
      organizationId,
      userId,
      chatId: chat.id,
      ticketNumber: chat.ticketNumber,
      channel: chat.channel,
      assignedUserId: chat.assignedUserId,
      organizationPhoneId: chat.organizationPhone?.id,
      connectionType: chat.organizationPhone?.connectionType,
      wabaPhoneNumberId: chat.organizationPhone?.wabaPhoneNumberId,
      hasWabaAccessToken: Boolean(chat.organizationPhone?.wabaAccessToken),
      wabaAccessTokenLength: chat.organizationPhone?.wabaAccessToken?.length,
      hasWabaId: Boolean(chat.organizationPhone?.wabaId),
      wabaApiVersion: chat.organizationPhone?.wabaApiVersion,
      remoteJid: chat.remoteJid,
      receivingPhoneJid: chat.receivingPhoneJid,
      hasTelegramBot: Boolean(chat.telegramBot),
      hasTelegramChatId: Boolean(chat.telegramChatId),
      hasWebsiteSession: Boolean(chat.websiteSession),
    });

    if (!chat.assignedUserId) {
      logger.warn(`[sendMessageByChat] Чат ${chat.id} не назначен ответственному. Отправка запрещена.`);
      consoleSendLog('SEND-BY-CHAT', 'chat-not-assigned', {
        chatId: chat.id,
        ticketNumber: chat.ticketNumber,
      });
      return res.status(400).json({ error: 'Нельзя отправлять сообщения: чат не назначен ответственному сотруднику.' });
    }

    const channel = chat.channel;
    let sentMessage: any;
    let messageContent = '';

    // Определяем метод отправки в зависимости от канала
    if (channel === 'website') {
      if (type !== 'text') {
        return res.status(400).json({
          error: 'Для виджета сайта сейчас поддерживаются только текстовые сообщения.',
        });
      }

      if (!chat.websiteSession) {
        return res.status(500).json({ error: 'У чата отсутствует сессия виджета сайта.' });
      }

      const now = new Date();
      const savedMessage = await prisma.message.create({
        data: {
          organizationId: chat.organizationId,
          channel: 'website',
          chatId: chat.id,
          fromMe: true,
          content: text.trim(),
          type: 'text',
          timestamp: now,
          status: 'sent',
          senderUserId: userId,
          isReadByOperator: true,
          isHr: chat.isHr,
        },
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          lastMessageAt: now,
          firstResponseAt: chat.firstResponseAt || now,
        },
      });

      const event = {
        id: savedMessage.id,
        chatId: savedMessage.chatId,
        content: savedMessage.content,
        type: savedMessage.type,
        fromMe: true,
        timestamp: savedMessage.timestamp,
        status: savedMessage.status,
        senderUserId: userId,
        channel: 'website',
      };
      const { notifyNewMessage, notifyWebsiteVisitor } = await import('../services/socketService');
      notifyNewMessage(organizationId, event);
      notifyWebsiteVisitor(chat.websiteSession.id, 'message:new', {
        id: savedMessage.id,
        content: savedMessage.content,
        type: savedMessage.type,
        fromMe: true,
        timestamp: savedMessage.timestamp,
        status: savedMessage.status,
        senderUser: chat.assignedUser
          ? { name: chat.assignedUser.name }
          : null,
      });

      return res.status(200).json({
        success: true,
        messageId: savedMessage.id,
        chatId: chat.id,
        ticketNumber: chat.ticketNumber,
        ticket: chat.ticketNumber
          ? {
              number: chat.ticketNumber,
              status: chat.status,
              priority: chat.priority,
            }
          : null,
        channel: 'website',
        type: 'text',
        message: savedMessage,
      });
    } else if (channel === 'telegram') {
      // Используем Telegram Bot API
      logger.info(`[sendMessageByChat] Используем Telegram для чата ${chatId}`);

      if (!chat.telegramBot || !chat.telegramChatId) {
        logger.error(`[sendMessageByChat] У чата ${chatId} отсутствует telegramBot или telegramChatId.`);
        consoleSendLog('SEND-BY-CHAT', 'telegram-chat-data-missing', {
          chatId: chat.id,
          hasTelegramBot: Boolean(chat.telegramBot),
          hasTelegramChatId: Boolean(chat.telegramChatId),
        });
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
            logger.error(`[sendMessageByChat] ОШИБКА: Отсутствует mediaUrl для документа в Telegram`, {
              chatId,
              type,
              channel,
            });
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
            logger.error(`[sendMessageByChat] ОШИБКА: Отсутствует mediaUrl для видео в Telegram`, {
              chatId,
              type,
              channel,
            });
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
            logger.error(`[sendMessageByChat] ОШИБКА: Отсутствует mediaUrl для аудио в Telegram`, {
              chatId,
              type,
              channel,
            });
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
          logger.error(`[sendMessageByChat] ОШИБКА: Неподдерживаемый тип сообщения для Telegram`, {
            requestedType: type,
            chatId,
            channel,
          });
          return res.status(400).json({ 
            error: `Тип ${type} не поддерживается для Telegram. Поддерживаются: text, image, document, video, audio` 
          });
        }

        logger.info(`[sendMessageByChat] Успешно: Telegram сообщение (${type}) отправлено в чат ${chatId}`, {
          messageId: sentMessage.message_id,
          type,
          chatId,
          telegramChatId: chat.telegramChatId,
        });
        
        return res.status(200).json({
          success: true,
          messageId: sentMessage.message_id,
          chatId: chat.id,
          ticketNumber: chat.ticketNumber,
          ticket: chat.ticketNumber
            ? {
                number: chat.ticketNumber,
                status: chat.status,
                priority: chat.priority,
              }
            : null,
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
        consoleSendLog('SEND-BY-CHAT', 'organization-phone-missing', {
          chatId: chat.id,
          channel,
        });
        return res.status(500).json({ error: 'У чата отсутствует привязка к телефону организации.' });
      }

      const connectionType = chat.organizationPhone.connectionType || 'baileys';
      consoleSendLog('SEND-BY-CHAT', 'whatsapp-branch', {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhone.id,
        connectionType,
        remoteJid: chat.remoteJid,
        type,
      });

      if (connectionType === 'waba') {
      // Используем WABA API
      logger.info(`[sendMessageByChat] Используем WABA для чата ${chatId}`);
      
      const { createWABAService } = await import('../services/wabaService');
      const wabaService = await createWABAService(chat.organizationPhone.id);
      
      if (!wabaService) {
        logger.error(`[sendMessageByChat] ОШИБКА: WABA сервис не настроен`, {
          organizationPhoneId: chat.organizationPhone.id,
          chatId,
          type,
        });
        return res.status(500).json({ error: 'WABA сервис не настроен для этого телефона.' });
      }

      const recipientPhone = chat.remoteJid.replace('@s.whatsapp.net', '');
      const wabaApiVersion = chat.organizationPhone.wabaApiVersion || 'v21.0';
      const wabaPhoneNumberId = chat.organizationPhone.wabaPhoneNumberId;

      logger.info(`[sendMessageByChat] Отправка WABA сообщения`, {
        type,
        recipientPhone,
        chatId,
        organizationPhoneId: chat.organizationPhone.id,
      });

      consoleSendLog('SEND-BY-CHAT', 'waba-calling-send', {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhone.id,
        type,
        recipientPhone,
        recipientPhoneLength: recipientPhone.length,
        graphApiVersion: wabaApiVersion,
        wabaPhoneNumberId,
        graphPath: wabaPhoneNumberId ? `/${wabaApiVersion}/${wabaPhoneNumberId}/messages` : null,
        hasWabaAccessToken: Boolean(chat.organizationPhone.wabaAccessToken),
        wabaAccessTokenLength: chat.organizationPhone.wabaAccessToken?.length,
        hasWabaId: Boolean(chat.organizationPhone.wabaId),
        textLength: typeof text === 'string' ? text.length : null,
        hasMediaUrl: Boolean(mediaUrl),
        hasCaption: Boolean(caption),
        templateName: template?.name,
        templateLanguage: template?.language,
      });

      // Отправляем через WABA в зависимости от типа
      for (let attempt = 1; attempt <= WABA_SEND_MAX_ATTEMPTS; attempt += 1) {
        try {
          switch (type) {
            case 'text':
              logger.debug(`[sendMessageByChat] Отправка text через WABA`);
              sentMessage = await wabaService.sendTextMessage(recipientPhone, text);
              messageContent = text;
              break;

            case 'image':
              logger.debug(`[sendMessageByChat] Отправка image через WABA`, { mediaUrl, caption });
              sentMessage = await wabaService.sendImage(recipientPhone, mediaUrl, caption);
              messageContent = caption || '[Image]';
              break;

            case 'document':
              logger.debug(`[sendMessageByChat] Отправка document через WABA`, { mediaUrl, filename, caption });
              sentMessage = await wabaService.sendDocument(recipientPhone, mediaUrl, filename, caption);
              messageContent = caption || `[Document: ${filename || 'file'}]`;
              break;

            case 'video':
              logger.debug(`[sendMessageByChat] Отправка video через WABA`, { mediaUrl, caption });
              sentMessage = await wabaService.sendMessage({
                to: recipientPhone,
                type: 'video',
                video: { link: mediaUrl, caption }
              });
              messageContent = caption || '[Video]';
              break;

            case 'audio':
              logger.debug(`[sendMessageByChat] Отправка audio через WABA`, { mediaUrl });
              sentMessage = await wabaService.sendMessage({
                to: recipientPhone,
                type: 'audio',
                audio: { link: mediaUrl }
              });
              messageContent = '[Audio]';
              break;

            case 'template':
              logger.debug(`[sendMessageByChat] Отправка template через WABA`, {
                templateName: template.name,
                language: template.language
              });
              sentMessage = await wabaService.sendTemplateMessage(
                recipientPhone,
                template.name,
                template.language || 'ru',
                template.components
              );
              messageContent = `Template: ${template.name}`;
              break;

            default:
              logger.error(`[sendMessageByChat] ОШИБКА: Неподдерживаемый тип сообщения для WABA`, {
                requestedType: type,
                chatId,
                channel,
              });
              return res.status(400).json({ error: `Неподдерживаемый тип сообщения: ${type}` });
          }
          break;
        } catch (error: any) {
          const errorSnapshot = getAxiosErrorSnapshot(error);
          const shouldRetry = attempt < WABA_SEND_MAX_ATTEMPTS && isRetriableWabaSendError(error);

          if (shouldRetry) {
            const retryDelayMs = WABA_SEND_RETRY_DELAYS_MS[attempt - 1];

            consoleSendLog('SEND-BY-CHAT', 'waba-send-retry', {
              chatId: chat.id,
              organizationPhoneId: chat.organizationPhone.id,
              type,
              recipientPhone,
              attempt,
              nextAttempt: attempt + 1,
              maxAttempts: WABA_SEND_MAX_ATTEMPTS,
              retryDelayMs,
              ...errorSnapshot,
            });
            await wait(retryDelayMs);
            continue;
          }

          logger.error(`[sendMessageByChat] Ошибка отправки WABA сообщения`, {
            chatId: chat.id,
            organizationPhoneId: chat.organizationPhone.id,
            type,
            recipientPhone,
            attempt,
            maxAttempts: WABA_SEND_MAX_ATTEMPTS,
            ...errorSnapshot,
          });
          consoleSendLog('SEND-BY-CHAT', 'waba-send-error', {
            chatId: chat.id,
            organizationPhoneId: chat.organizationPhone.id,
            type,
            recipientPhone,
            attempt,
            maxAttempts: WABA_SEND_MAX_ATTEMPTS,
            ...errorSnapshot,
          });

          const retryable = isRetriableWabaSendError(error);
          if (retryable) {
            res.setHeader('Retry-After', '30');
          }

          return res.status(getHttpStatusFromUpstreamError(error)).json({
            error: retryable
              ? 'Временная ошибка WhatsApp API. Попробуйте отправить сообщение еще раз через несколько секунд.'
              : 'Не удалось отправить сообщение через WABA.',
            details: errorSnapshot.errorMessage,
            retryable,
            upstreamStatus: error?.response?.status,
            upstreamError: errorSnapshot.responseData,
          });
        }
      }

      if (!sentMessage) {
        logger.error(`[sendMessageByChat] ОШИБКА ОТПРАВКИ: WABA сообщение не было отправлено`, {
          type,
          chatId,
          recipientPhone,
        });
        consoleSendLog('SEND-BY-CHAT', 'waba-result-empty', {
          chatId: chat.id,
          organizationPhoneId: chat.organizationPhone.id,
          type,
          recipientPhone,
        });
        return res.status(500).json({ error: 'WABA вернул пустой результат отправки.' });
      }

      consoleSendLog('SEND-BY-CHAT', 'waba-send-success', {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhone.id,
        type,
        messageId: sentMessage.messages?.[0]?.id,
      });

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
          isHr: chat.isHr,
        },
      });

      // Обновляем lastMessageAt
      await prisma.chat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });

      logger.info(`[sendMessageByChat] Успешно: WABA сообщение отправлено в чат ${chatId}`, {
        messageId: sentMessage.messages?.[0]?.id,
        type,
        chatId,
        remoteJid: chat.remoteJid,
        organizationPhoneId: chat.organizationPhone.id,
      });

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
        ticketNumber: chat.ticketNumber,
        ticket: chat.ticketNumber
          ? {
              number: chat.ticketNumber,
              status: chat.status,
              priority: chat.priority,
            }
          : null,
        channel: 'whatsapp',
        connectionType: 'waba',
        message: savedMessage,
      });

    } else {
      // Используем Baileys
      logger.info(`[sendMessageByChat] Используем Baileys для чата ${chatId}`);
      consoleSendLog('SEND-BY-CHAT', 'baileys-branch', {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhone.id,
        phoneJid: chat.organizationPhone.phoneJid,
        remoteJid: chat.remoteJid,
        type,
      });
      
      const sock = getBaileysSock(chat.organizationPhone.id);
      consoleSendLog('SEND-BY-CHAT', 'baileys-socket-check', {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhone.id,
        ...getSocketSnapshot(sock),
      });

      if (!sock || !sock.user) {
        logger.warn(`[sendMessageByChat] Baileys сокет для organizationPhoneId ${chat.organizationPhone.id} не готов.`);
        consoleSendLog('SEND-BY-CHAT', 'baileys-socket-not-ready', {
          chatId: chat.id,
          organizationPhoneId: chat.organizationPhone.id,
          ...getSocketSnapshot(sock),
        });
        return res.status(503).json({
          error: 'WhatsApp аккаунт не готов к отправке сообщений. Попробуйте позже.',
          details: 'Socket not ready or user not authenticated.'
        });
      }

      const normalizedReceiverJid = jidNormalizedUser(chat.remoteJid);

      if (!normalizedReceiverJid) {
        logger.error(`[sendMessageByChat] Некорректный remoteJid: "${chat.remoteJid}".`);
        consoleSendLog('SEND-BY-CHAT', 'baileys-invalid-remote-jid', {
          chatId: chat.id,
          remoteJid: chat.remoteJid,
        });
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
            consoleSendLog('SEND-BY-CHAT', 'baileys-media-url-missing', {
              chatId: chat.id,
              type,
            });
            return res.status(400).json({ 
              error: `Отсутствует mediaUrl для типа ${type}.` 
            });
          }

          try {
            // Скачиваем медиафайл
            logger.info(`[sendMessageByChat] Скачиваем медиа для Baileys: ${type} - ${mediaUrl}`);
            consoleSendLog('SEND-BY-CHAT', 'baileys-media-download-start', {
              chatId: chat.id,
              type,
              mediaUrl,
            });
            
            const response = await axios.get(mediaUrl, { responseType: 'arraybuffer' });
            const buffer = Buffer.from(response.data);

            logger.info(`[sendMessageByChat] Медиафайл успешно скачан`, {
              type,
              bufferSize: buffer.length,
              responseStatus: response.status,
            });
            consoleSendLog('SEND-BY-CHAT', 'baileys-media-download-success', {
              chatId: chat.id,
              type,
              bufferSize: buffer.length,
              responseStatus: response.status,
            });

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
            logger.error(`[sendMessageByChat] ОШИБКА при скачивании медиа`, {
              type,
              mediaUrl,
              errorMessage: error.message,
              errorCode: error.code,
              errorStack: error.stack,
              response: error.response?.status,
            });
            consoleSendLog('SEND-BY-CHAT', 'baileys-media-download-error', {
              chatId: chat.id,
              type,
              mediaUrl,
              errorMessage: error?.message,
              errorCode: error?.code,
              responseStatus: error?.response?.status,
            });
            return res.status(500).json({ 
              error: `Не удалось скачать медиафайл: ${error.message}` 
            });
          }
          break;
        }
        
        case 'template':
          consoleSendLog('SEND-BY-CHAT', 'baileys-template-not-supported', {
            chatId: chat.id,
            templateName: template?.name,
          });
          return res.status(400).json({ 
            error: 'Шаблоны не поддерживаются для Baileys подключений. Используйте только WABA.' 
          });
        
        default:
          consoleSendLog('SEND-BY-CHAT', 'baileys-unsupported-type', {
            chatId: chat.id,
            type,
          });
          return res.status(400).json({ error: `Неподдерживаемый тип сообщения: ${type}` });
      }

      consoleSendLog('SEND-BY-CHAT', 'baileys-calling-send', {
        organizationId,
        userId,
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhone.id,
        senderJid: chat.organizationPhone.phoneJid,
        normalizedReceiverJid,
        type,
        hasMediaInfo: Boolean(savedMediaPath || filename),
      });

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
        logger.error(`[sendMessageByChat] ОШИБКА ОТПРАВКИ: Baileys сообщение не было отправлено для чата ${chatId}`, {
          chatId,
          type,
          remoteJid: chat.remoteJid,
          connectionType: chat.organizationPhone.connectionType,
        });
        consoleSendLog('SEND-BY-CHAT', 'baileys-result-empty', {
          chatId: chat.id,
          organizationPhoneId: chat.organizationPhone.id,
          type,
          remoteJid: chat.remoteJid,
        });
        return res.status(500).json({ error: 'Не удалось отправить сообщение.' });
      }

      logger.info(`[sendMessageByChat] Успешно: Baileys сообщение отправлено в чат ${chatId}`, {
        messageId: sentMessage.key.id,
        type,
        chatId,
        remoteJid: chat.remoteJid,
        organizationPhoneId: chat.organizationPhone.id,
      });
      consoleSendLog('SEND-BY-CHAT', 'baileys-success', {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhone.id,
        messageId: sentMessage.key.id,
        type,
      });

      // Socket.IO уведомление отправляется автоматически в baileys.ts через sendMessage()
      // Дополнительное уведомление не требуется, так как baileys.ts уже обрабатывает это
      
      return res.status(200).json({
        success: true,
        messageId: sentMessage.key.id,
        chatId: chat.id,
        ticketNumber: chat.ticketNumber,
        ticket: chat.ticketNumber
          ? {
              number: chat.ticketNumber,
              status: chat.status,
              priority: chat.priority,
            }
          : null,
        channel: 'whatsapp',
        connectionType: 'baileys',
      });
      }
    } else {
      // Неизвестный канал
      logger.error(`[sendMessageByChat] Неподдерживаемый канал: ${channel}`);
      consoleSendLog('SEND-BY-CHAT', 'unsupported-channel', {
        chatId,
        channel,
      });
      return res.status(400).json({ error: `Неподдерживаемый канал: ${channel}` });
    }

  } catch (error: any) {
    logger.error(`[sendMessageByChat] Критическая ошибка при отправке сообщения в чат ${req.body.chatId}`, {
      errorMessage: error.message,
      errorStack: error.stack,
      errorCode: error.code,
      requestBody: {
        chatId: req.body.chatId,
        type: req.body.type,
        hasMediaUrl: !!req.body.mediaUrl,
        hasText: !!req.body.text,
      },
    });
    consoleSendLog('SEND-BY-CHAT', 'critical-error', {
      chatId: req.body.chatId,
      type: req.body.type,
      hasMediaUrl: Boolean(req.body.mediaUrl),
      hasText: Boolean(req.body.text),
      errorMessage: error?.message,
      errorCode: error?.code,
    });
    res.status(500).json({
      error: 'Не удалось отправить сообщение.',
      details: error.message,
    });
  }
};
