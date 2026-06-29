// src/controllers/mediaController.ts

import { Request, Response } from 'express';
import multer from 'multer';
import { saveUploadedMedia, validateMediaFile } from '../services/mediaService';
import { sendMessage, getBaileysSock } from '../config/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { prisma } from '../config/authStorage';
import { createLogger } from '../config/logging';
import { chatVisibilityWhere, userCanAccessHrChats } from '../auth/hrAccess';

const logger = createLogger();

function consoleMediaSendLog(event: string, data: Record<string, unknown> = {}) {
  try {
    console.log('[MEDIA BAILEYS SEND]', JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }));
  } catch (error) {
    console.log('[MEDIA BAILEYS SEND LOG ERROR]', String(error));
  }
}

function getSocketSnapshot(sock: any) {
  return {
    hasSock: Boolean(sock),
    hasUser: Boolean(sock?.user),
    sockUserId: sock?.user?.id,
    wsState: sock?.ws?.readyState,
  };
}

// Настройка multer для загрузки файлов в память
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 50 * 1024 * 1024, // 50MB максимум
  },
});

/**
 * Middleware для загрузки одного файла
 */
export const uploadSingle = upload.single('media');

/**
 * Загрузить и отправить медиафайл по chatId
 */
export const uploadAndSendMedia = async (req: Request, res: Response) => {
  const { chatId, mediaType, caption } = req.body;
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;
  const file = req.file;
  const canAccessHrChats = userCanAccessHrChats(res.locals);

  consoleMediaSendLog('upload-and-send-request', {
    organizationId,
    userId,
    chatId,
    mediaType,
    hasFile: Boolean(file),
    fileName: file?.originalname,
    fileMimeType: file?.mimetype,
    fileSize: file?.size,
    hasCaption: Boolean(caption),
  });

  // 1. Валидация входных данных
  if (!chatId || !mediaType || !file) {
    logger.warn('[uploadAndSendMedia] Отсутствуют необходимые параметры');
    consoleMediaSendLog('upload-and-send-validation-failed', {
      chatId,
      mediaType,
      hasFile: Boolean(file),
    });
    return res.status(400).json({ 
      error: 'Отсутствуют необходимые параметры: chatId, mediaType или файл' 
    });
  }

  // 2. Проверка типа медиа
  const allowedMediaTypes: Array<'image' | 'video' | 'document' | 'audio'> = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    logger.warn(`[uploadAndSendMedia] Неподдерживаемый тип медиа: "${mediaType}"`);
    consoleMediaSendLog('upload-and-send-unsupported-type', { mediaType });
    return res.status(400).json({ 
      error: `Неподдерживаемый тип медиа. Разрешены: ${allowedMediaTypes.join(', ')}` 
    });
  }

  // 3. Валидация файла
  const validation = validateMediaFile(file.buffer, file.mimetype, mediaType);
  if (!validation.valid) {
    consoleMediaSendLog('upload-and-send-file-validation-failed', {
      chatId,
      mediaType,
      fileName: file.originalname,
      fileMimeType: file.mimetype,
      fileSize: file.size,
      error: validation.error,
    });
    return res.status(400).json({ error: validation.error });
  }

  try {
    // 4. Получаем информацию о чате
    const chat = await prisma.chat.findFirst({
      where: {
        id: parseInt(chatId, 10),
        organizationId: organizationId,
        ...chatVisibilityWhere(canAccessHrChats),
      },
      include: {
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
          },
        },
      },
    });

    if (!chat) {
      logger.warn(`[uploadAndSendMedia] Чат с ID ${chatId} не найден для организации ${organizationId}`);
      consoleMediaSendLog('upload-and-send-chat-not-found', {
        organizationId,
        chatId,
      });
      return res.status(404).json({ error: 'Чат не найден' });
    }

    if (!chat.organizationPhone?.phoneJid) {
      logger.error(`[uploadAndSendMedia] phoneJid не найден для чата ${chatId}`);
      consoleMediaSendLog('upload-and-send-phone-missing', {
        chatId: chat.id,
        hasOrganizationPhone: Boolean(chat.organizationPhone),
      });
      return res.status(400).json({ error: 'Номер телефона организации не настроен для этого чата' });
    }

    const organizationPhoneId = chat.organizationPhone.id;
    const senderJid = chat.organizationPhone.phoneJid;
    const receiverJid = chat.remoteJid;

    // 5. Нормализация JID получателя
    const normalizedReceiverJid = jidNormalizedUser(receiverJid);
    if (!normalizedReceiverJid) {
      logger.error(`[uploadAndSendMedia] Некорректный receiverJid: "${receiverJid}"`);
      consoleMediaSendLog('upload-and-send-invalid-receiver', {
        chatId: chat.id,
        receiverJid,
      });
      return res.status(400).json({ error: 'Некорректный JID получателя' });
    }

    // 6. Получение Baileys сокета
    const sock = getBaileysSock(organizationPhoneId);
    consoleMediaSendLog('upload-and-send-socket-check', {
      chatId: chat.id,
      organizationPhoneId,
      normalizedReceiverJid,
      ...getSocketSnapshot(sock),
    });
    if (!sock || !sock.user) {
      logger.warn(`[uploadAndSendMedia] Сокет для organizationPhoneId ${organizationPhoneId} не готов`);
      consoleMediaSendLog('upload-and-send-socket-not-ready', {
        chatId: chat.id,
        organizationPhoneId,
        ...getSocketSnapshot(sock),
      });
      return res.status(503).json({ 
        error: `WhatsApp аккаунт не подключен или не готов к отправке сообщений`,
        details: 'Socket not ready or user not authenticated.'
      });
    }

    // 7. Сохранение файла
    const savedMedia = await saveUploadedMedia(
      file.buffer,
      file.originalname,
      file.mimetype,
      mediaType
    );

    if (!savedMedia.success) {
      consoleMediaSendLog('upload-and-send-save-media-failed', {
        chatId: chat.id,
        organizationPhoneId,
        fileName: file.originalname,
        error: savedMedia.error,
      });
      return res.status(500).json({ error: 'Ошибка сохранения файла', details: savedMedia.error });
    }

    // Логирование для отладки
    logger.info(`[uploadAndSendMedia] Файл сохранен:`, {
      url: savedMedia.url,
      fileName: savedMedia.fileName,
      size: savedMedia.size,
      originalName: file.originalname
    });
    consoleMediaSendLog('upload-and-send-save-media-success', {
      chatId: chat.id,
      organizationPhoneId,
      mediaType,
      mediaUrl: savedMedia.url,
      fileName: savedMedia.fileName,
      size: savedMedia.size,
    });

    // 8. Подготовка контента для отправки
    let messageContent: any;
    
    switch (mediaType) {
      case 'image':
        messageContent = {
          image: file.buffer,
          caption: caption || '',
        };
        break;
      case 'video':
        messageContent = {
          video: file.buffer,
          caption: caption || '',
        };
        break;
      case 'document':
        messageContent = {
          document: file.buffer,
          fileName: file.originalname,
          caption: caption || '',
        };
        break;
      case 'audio':
        messageContent = {
          audio: file.buffer,
          mimetype: file.mimetype,
        };
        break;
    }

    // 9. Отправка медиафайла с информацией о сохраненном файле
    consoleMediaSendLog('upload-and-send-calling-baileys', {
      organizationId,
      userId,
      chatId: chat.id,
      organizationPhoneId,
      senderJid,
      normalizedReceiverJid,
      mediaType,
      fileName: file.originalname,
    });

    const sentMessage = await sendMessage(
      sock,
      normalizedReceiverJid,
      messageContent,
      organizationId,
      organizationPhoneId,
      senderJid,
      userId,
      {
        mediaUrl: savedMedia.url,
        filename: savedMedia.fileName || file.originalname,
        size: savedMedia.size
      }
    );

    if (!sentMessage) {
      logger.error(`❌ Медиафайл не был отправлен на ${normalizedReceiverJid}`);
      consoleMediaSendLog('upload-and-send-result-empty', {
        chatId: chat.id,
        organizationPhoneId,
        normalizedReceiverJid,
        mediaType,
      });
      return res.status(500).json({ error: 'Не удалось отправить медиафайл' });
    }

    // 10. Успешная отправка
    logger.info(`✅ Медиафайл "${file.originalname}" отправлен в чат ${chatId}`);
    consoleMediaSendLog('upload-and-send-success', {
      chatId: chat.id,
      organizationPhoneId,
      messageId: sentMessage.key.id,
      mediaType,
    });
    
    res.status(200).json({
      success: true,
      messageId: sentMessage.key.id,
      chatId: parseInt(chatId, 10),
      mediaType,
      fileName: file.originalname,
      fileUrl: savedMedia.url,
      caption: caption || null,
      size: savedMedia.size,
    });

  } catch (error: any) {
    logger.error(`❌ Критическая ошибка при отправке медиафайла:`, error);
    consoleMediaSendLog('upload-and-send-error', {
      chatId,
      mediaType,
      errorMessage: error?.message,
      errorCode: error?.code,
    });
    res.status(500).json({ 
      error: 'Критическая ошибка при отправке медиафайла', 
      details: error.message 
    });
  }
};

/**
 * Просто загрузить медиафайл без отправки
 */
export const uploadMediaOnly = async (req: Request, res: Response) => {
  const { mediaType } = req.body;
  const file = req.file;

  if (!mediaType || !file) {
    return res.status(400).json({ 
      error: 'Отсутствуют необходимые параметры: mediaType или файл' 
    });
  }

  const allowedMediaTypes: Array<'image' | 'video' | 'document' | 'audio'> = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    return res.status(400).json({ 
      error: `Неподдерживаемый тип медиа. Разрешены: ${allowedMediaTypes.join(', ')}` 
    });
  }

  // Валидация файла
  const validation = validateMediaFile(file.buffer, file.mimetype, mediaType);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    // Сохранение файла
    const savedMedia = await saveUploadedMedia(
      file.buffer,
      file.originalname,
      file.mimetype,
      mediaType
    );

    if (!savedMedia.success) {
      return res.status(500).json({ 
        error: 'Ошибка сохранения файла', 
        details: savedMedia.error 
      });
    }

    logger.info(`✅ Медиафайл "${file.originalname}" сохранен`);
    
    res.status(200).json({
      success: true,
      fileName: savedMedia.fileName,
      fileUrl: savedMedia.url,
      filePath: savedMedia.filePath,
      mediaType,
      size: savedMedia.size,
      mimeType: savedMedia.mimeType,
    });

  } catch (error: any) {
    logger.error(`❌ Ошибка загрузки медиафайла:`, error);
    res.status(500).json({ 
      error: 'Ошибка загрузки медиафайла', 
      details: error.message 
    });
  }
};

/**
 * Загрузить медиафайл для использования в WABA
 * Возвращает публичный URL для передачи в WABA API
 * POST /api/media/upload-for-waba
 */
export const uploadMediaForWABA = async (req: Request, res: Response) => {
  const { mediaType } = req.body;
  const organizationId = res.locals.organizationId;
  const file = req.file;

  if (!mediaType || !file) {
    return res.status(400).json({ 
      error: 'Отсутствуют необходимые параметры: mediaType или файл' 
    });
  }

  const allowedMediaTypes: Array<'image' | 'video' | 'document' | 'audio'> = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    return res.status(400).json({ 
      error: `Неподдерживаемый тип медиа. Разрешены: ${allowedMediaTypes.join(', ')}` 
    });
  }

  // Валидация файла
  const validation = validateMediaFile(file.buffer, file.mimetype, mediaType);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    // Сохранение файла
    const savedMedia = await saveUploadedMedia(
      file.buffer,
      file.originalname,
      file.mimetype,
      mediaType
    );

    if (!savedMedia.success) {
      return res.status(500).json({ 
        error: 'Ошибка сохранения файла', 
        details: savedMedia.error 
      });
    }

    logger.info(`✅ [WABA] Медиафайл "${file.originalname}" загружен для организации ${organizationId}`);
    
    // Возвращаем URL для использования в WABA API
    res.status(200).json({
      success: true,
      mediaUrl: savedMedia.url,  // Публичный URL для WABA
      fileName: savedMedia.fileName,
      mediaType,
      size: savedMedia.size,
      mimeType: savedMedia.mimeType,
      // Дополнительная информация для клиента
      metadata: {
        originalName: file.originalname,
        uploadedAt: new Date().toISOString(),
        organizationId,
      }
    });

  } catch (error: any) {
    logger.error(`❌ [WABA] Ошибка загрузки медиафайла:`, error);
    res.status(500).json({ 
      error: 'Ошибка загрузки медиафайла', 
      details: error.message 
    });
  }
};

/**
 * Отправить медиафайл по chatId
 */
export const sendMediaByChatId = async (req: Request, res: Response) => {
  const { chatId, mediaType, mediaPath, caption, filename } = req.body;
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;
  const canAccessHrChats = userCanAccessHrChats(res.locals);

  consoleMediaSendLog('send-by-chat-request', {
    organizationId,
    userId,
    chatId,
    mediaType,
    hasMediaPath: Boolean(mediaPath),
    hasCaption: Boolean(caption),
    filename,
  });

  // 1. Валидация входных данных
  if (!chatId || !mediaType || !mediaPath) {
    logger.warn('[sendMediaByChatId] Отсутствуют необходимые параметры');
    consoleMediaSendLog('send-by-chat-validation-failed', {
      chatId,
      mediaType,
      hasMediaPath: Boolean(mediaPath),
    });
    return res.status(400).json({ 
      error: 'Отсутствуют необходимые параметры: chatId, mediaType, mediaPath' 
    });
  }

  // 2. Проверка типа медиа
  const allowedMediaTypes: Array<'image' | 'video' | 'document' | 'audio'> = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    logger.warn(`[sendMediaByChatId] Неподдерживаемый тип медиа: "${mediaType}"`);
    consoleMediaSendLog('send-by-chat-unsupported-type', { mediaType });
    return res.status(400).json({ 
      error: `Неподдерживаемый тип медиа. Разрешены: ${allowedMediaTypes.join(', ')}` 
    });
  }

  try {
    // 3. Получаем информацию о чате
    const chat = await prisma.chat.findFirst({
      where: {
        id: parseInt(chatId, 10),
        organizationId: organizationId,
        ...chatVisibilityWhere(canAccessHrChats),
      },
      include: {
        organizationPhone: {
          select: {
            id: true,
            phoneJid: true,
          },
        },
      },
    });

    if (!chat) {
      logger.warn(`[sendMediaByChatId] Чат с ID ${chatId} не найден для организации ${organizationId}`);
      consoleMediaSendLog('send-by-chat-chat-not-found', {
        organizationId,
        chatId,
      });
      return res.status(404).json({ error: 'Чат не найден' });
    }

    if (!chat.organizationPhone?.phoneJid) {
      logger.error(`[sendMediaByChatId] phoneJid не найден для чата ${chatId}`);
      consoleMediaSendLog('send-by-chat-phone-missing', {
        chatId: chat.id,
        hasOrganizationPhone: Boolean(chat.organizationPhone),
      });
      return res.status(400).json({ error: 'Номер телефона организации не настроен для этого чата' });
    }

    const organizationPhoneId = chat.organizationPhone.id;
    const senderJid = chat.organizationPhone.phoneJid;
    const receiverJid = chat.remoteJid;

    // 4. Нормализация JID получателя
    const normalizedReceiverJid = jidNormalizedUser(receiverJid);
    if (!normalizedReceiverJid) {
      logger.error(`[sendMediaByChatId] Некорректный receiverJid: "${receiverJid}"`);
      consoleMediaSendLog('send-by-chat-invalid-receiver', {
        chatId: chat.id,
        receiverJid,
      });
      return res.status(400).json({ error: 'Некорректный JID получателя' });
    }

    // 5. Получение Baileys сокета
    const sock = getBaileysSock(organizationPhoneId);
    consoleMediaSendLog('send-by-chat-socket-check', {
      chatId: chat.id,
      organizationPhoneId,
      normalizedReceiverJid,
      ...getSocketSnapshot(sock),
    });
    if (!sock || !sock.user) {
      logger.warn(`[sendMediaByChatId] Сокет для organizationPhoneId ${organizationPhoneId} не готов`);
      consoleMediaSendLog('send-by-chat-socket-not-ready', {
        chatId: chat.id,
        organizationPhoneId,
        ...getSocketSnapshot(sock),
      });
      return res.status(503).json({ 
        error: `WhatsApp аккаунт не подключен или не готов к отправке сообщений`,
        details: 'Socket not ready or user not authenticated.'
      });
    }

    // 6. Подготовка контента для отправки
    let messageContent: any;

    // Проверяем, является ли mediaPath полным URL (http/https) или локальным относительным путем
    const isFullUrl = mediaPath.startsWith('http://') || mediaPath.startsWith('https://');
    const isRelativePath = mediaPath.startsWith('/');
    
    if (isFullUrl) {
      consoleMediaSendLog('send-by-chat-media-source-url', {
        chatId: chat.id,
        organizationPhoneId,
        mediaType,
        mediaPath,
      });
      // Если это полный URL (включая R2), отправляем как есть
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
            mimetype: 'audio/mp4',
          };
          break;
      }
    } else if (isRelativePath) {
      // УСТАРЕВШИЙ СЛУЧАЙ: относительный путь /media/... (для обратной совместимости)
      // В новой версии все файлы должны быть полными URL из R2
      logger.warn(`[sendMediaByChatId] ⚠️ Используется устаревший относительный путь: ${mediaPath}`);
      logger.warn(`[sendMediaByChatId] Рекомендуется использовать полный URL из R2`);
      consoleMediaSendLog('send-by-chat-media-source-relative', {
        chatId: chat.id,
        organizationPhoneId,
        mediaType,
        mediaPath,
      });
      
      const fullUrl = `${req.protocol}://${req.get('host')}${mediaPath}`;
      
      switch (mediaType) {
        case 'image':
          messageContent = {
            image: { url: fullUrl },
            caption: caption || '',
          };
          break;
        case 'video':
          messageContent = {
            video: { url: fullUrl },
            caption: caption || '',
          };
          break;
        case 'document':
          messageContent = {
            document: { url: fullUrl },
            fileName: filename || 'document',
            caption: caption || '',
          };
          break;
        case 'audio':
          messageContent = {
            audio: { url: fullUrl },
            mimetype: 'audio/mp4',
          };
          break;
      }
    } else {
      // Если это локальный путь, читаем файл
      const fs = require('fs');
      const path = require('path');
      
      const fullPath = path.isAbsolute(mediaPath) ? mediaPath : path.join(process.cwd(), mediaPath);
      
      if (!fs.existsSync(fullPath)) {
        logger.error(`[sendMediaByChatId] Файл не найден: ${fullPath}`);
        consoleMediaSendLog('send-by-chat-local-file-not-found', {
          chatId: chat.id,
          organizationPhoneId,
          mediaType,
          fullPath,
        });
        return res.status(404).json({ error: 'Медиафайл не найден' });
      }

      const fileBuffer = fs.readFileSync(fullPath);
      consoleMediaSendLog('send-by-chat-media-source-local', {
        chatId: chat.id,
        organizationPhoneId,
        mediaType,
        fullPath,
        size: fileBuffer.length,
      });
      
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

    // 7. Отправка медиафайла с информацией о файле
    consoleMediaSendLog('send-by-chat-calling-baileys', {
      organizationId,
      userId,
      chatId: chat.id,
      organizationPhoneId,
      senderJid,
      normalizedReceiverJid,
      mediaType,
      filename,
    });

    const sentMessage = await sendMessage(
      sock,
      normalizedReceiverJid,
      messageContent,
      organizationId,
      organizationPhoneId,
      senderJid,
      userId,
      {
        mediaUrl: isFullUrl ? mediaPath : (isRelativePath ? `${req.protocol}://${req.get('host')}${mediaPath}` : undefined),
        filename: filename || (!isFullUrl && !isRelativePath ? require('path').basename(mediaPath) : undefined),
        size: !isFullUrl && !isRelativePath ? require('fs').statSync(require('path').isAbsolute(mediaPath) ? mediaPath : require('path').join(process.cwd(), mediaPath)).size : undefined
      }
    );

    if (!sentMessage) {
      logger.error(`[sendMediaByChatId] Медиафайл не был отправлен`);
      consoleMediaSendLog('send-by-chat-result-empty', {
        chatId: chat.id,
        organizationPhoneId,
        normalizedReceiverJid,
        mediaType,
      });
      return res.status(500).json({ error: 'Не удалось отправить медиафайл' });
    }

    // 8. Успешная отправка
    logger.info(`✅ Медиафайл типа "${mediaType}" отправлен в чат ${chatId}. WhatsApp Message ID: ${sentMessage.key.id}`);
    consoleMediaSendLog('send-by-chat-success', {
      chatId: chat.id,
      organizationPhoneId,
      messageId: sentMessage.key.id,
      mediaType,
    });
    
    res.status(200).json({ 
      success: true, 
      messageId: sentMessage.key.id,
      chatId: chatId,
      mediaType: mediaType,
      caption: caption || null,
    });

  } catch (error: any) {
    logger.error(`❌ Ошибка при отправке медиафайла в чат ${chatId}:`, error);
    consoleMediaSendLog('send-by-chat-error', {
      chatId,
      mediaType,
      hasMediaPath: Boolean(mediaPath),
      errorMessage: error?.message,
      errorCode: error?.code,
    });
    res.status(500).json({ 
      error: 'Ошибка отправки медиафайла', 
      details: error.message 
    });
  }
};
