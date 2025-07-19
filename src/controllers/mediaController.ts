// src/controllers/mediaController.ts

import { Request, Response } from 'express';
import multer from 'multer';
import { saveUploadedMedia, validateMediaFile } from '../services/mediaService';
import { sendMessage, getBaileysSock } from '../config/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

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

  // 1. Валидация входных данных
  if (!chatId || !mediaType || !file) {
    logger.warn('[uploadAndSendMedia] Отсутствуют необходимые параметры');
    return res.status(400).json({ 
      error: 'Отсутствуют необходимые параметры: chatId, mediaType или файл' 
    });
  }

  // 2. Проверка типа медиа
  const allowedMediaTypes: Array<'image' | 'video' | 'document' | 'audio'> = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    logger.warn(`[uploadAndSendMedia] Неподдерживаемый тип медиа: "${mediaType}"`);
    return res.status(400).json({ 
      error: `Неподдерживаемый тип медиа. Разрешены: ${allowedMediaTypes.join(', ')}` 
    });
  }

  // 3. Валидация файла
  const validation = validateMediaFile(file.buffer, file.mimetype, mediaType);
  if (!validation.valid) {
    return res.status(400).json({ error: validation.error });
  }

  try {
    // 4. Получаем информацию о чате
    const chat = await prisma.chat.findFirst({
      where: {
        id: parseInt(chatId, 10),
        organizationId: organizationId,
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
      return res.status(404).json({ error: 'Чат не найден' });
    }

    if (!chat.organizationPhone?.phoneJid) {
      logger.error(`[uploadAndSendMedia] phoneJid не найден для чата ${chatId}`);
      return res.status(400).json({ error: 'Номер телефона организации не настроен для этого чата' });
    }

    const organizationPhoneId = chat.organizationPhone.id;
    const senderJid = chat.organizationPhone.phoneJid;
    const receiverJid = chat.remoteJid;

    // 5. Нормализация JID получателя
    const normalizedReceiverJid = jidNormalizedUser(receiverJid);
    if (!normalizedReceiverJid) {
      logger.error(`[uploadAndSendMedia] Некорректный receiverJid: "${receiverJid}"`);
      return res.status(400).json({ error: 'Некорректный JID получателя' });
    }

    // 6. Получение Baileys сокета
    const sock = getBaileysSock(organizationPhoneId);
    if (!sock || !sock.user) {
      logger.warn(`[uploadAndSendMedia] Сокет для organizationPhoneId ${organizationPhoneId} не готов`);
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
      return res.status(500).json({ error: 'Ошибка сохранения файла', details: savedMedia.error });
    }

    // Логирование для отладки
    logger.info(`[uploadAndSendMedia] Файл сохранен:`, {
      url: savedMedia.url,
      fileName: savedMedia.fileName,
      size: savedMedia.size,
      originalName: file.originalname
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
      return res.status(500).json({ error: 'Не удалось отправить медиафайл' });
    }

    // 10. Успешная отправка
    logger.info(`✅ Медиафайл "${file.originalname}" отправлен в чат ${chatId}`);
    
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
 * Отправить медиафайл по chatId
 */
export const sendMediaByChatId = async (req: Request, res: Response) => {
  const { chatId, mediaType, mediaPath, caption, filename } = req.body;
  const organizationId = res.locals.organizationId;
  const userId = res.locals.userId;

  // 1. Валидация входных данных
  if (!chatId || !mediaType || !mediaPath) {
    logger.warn('[sendMediaByChatId] Отсутствуют необходимые параметры');
    return res.status(400).json({ 
      error: 'Отсутствуют необходимые параметры: chatId, mediaType, mediaPath' 
    });
  }

  // 2. Проверка типа медиа
  const allowedMediaTypes: Array<'image' | 'video' | 'document' | 'audio'> = ['image', 'video', 'document', 'audio'];
  if (!allowedMediaTypes.includes(mediaType)) {
    logger.warn(`[sendMediaByChatId] Неподдерживаемый тип медиа: "${mediaType}"`);
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
      return res.status(404).json({ error: 'Чат не найден' });
    }

    if (!chat.organizationPhone?.phoneJid) {
      logger.error(`[sendMediaByChatId] phoneJid не найден для чата ${chatId}`);
      return res.status(400).json({ error: 'Номер телефона организации не настроен для этого чата' });
    }

    const organizationPhoneId = chat.organizationPhone.id;
    const senderJid = chat.organizationPhone.phoneJid;
    const receiverJid = chat.remoteJid;

    // 4. Нормализация JID получателя
    const normalizedReceiverJid = jidNormalizedUser(receiverJid);
    if (!normalizedReceiverJid) {
      logger.error(`[sendMediaByChatId] Некорректный receiverJid: "${receiverJid}"`);
      return res.status(400).json({ error: 'Некорректный JID получателя' });
    }

    // 5. Получение Baileys сокета
    const sock = getBaileysSock(organizationPhoneId);
    if (!sock || !sock.user) {
      logger.warn(`[sendMediaByChatId] Сокет для organizationPhoneId ${organizationPhoneId} не готов`);
      return res.status(503).json({ 
        error: `WhatsApp аккаунт не подключен или не готов к отправке сообщений`,
        details: 'Socket not ready or user not authenticated.'
      });
    }

    // 6. Подготовка контента для отправки
    let messageContent: any;

    // Проверяем, является ли mediaPath URL или локальным путем
    const isUrl = mediaPath.startsWith('http://') || mediaPath.startsWith('https://') || mediaPath.startsWith('/');
    
    if (isUrl) {
      // Если это URL или путь, отправляем как ссылку
      const fullUrl = mediaPath.startsWith('/') ? `${req.protocol}://${req.get('host')}${mediaPath}` : mediaPath;
      
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
        return res.status(404).json({ error: 'Медиафайл не найден' });
      }

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

    // 7. Отправка медиафайла с информацией о файле
    const sentMessage = await sendMessage(
      sock,
      normalizedReceiverJid,
      messageContent,
      organizationId,
      organizationPhoneId,
      senderJid,
      userId,
      {
        mediaUrl: isUrl ? (mediaPath.startsWith('/') ? `${req.protocol}://${req.get('host')}${mediaPath}` : mediaPath) : undefined,
        filename: filename || (isUrl ? undefined : require('path').basename(mediaPath)),
        size: isUrl ? undefined : require('fs').statSync(require('path').isAbsolute(mediaPath) ? mediaPath : require('path').join(process.cwd(), mediaPath)).size
      }
    );

    if (!sentMessage) {
      logger.error(`[sendMediaByChatId] Медиафайл не был отправлен`);
      return res.status(500).json({ error: 'Не удалось отправить медиафайл' });
    }

    // 8. Успешная отправка
    logger.info(`✅ Медиафайл типа "${mediaType}" отправлен в чат ${chatId}. WhatsApp Message ID: ${sentMessage.key.id}`);
    
    res.status(200).json({ 
      success: true, 
      messageId: sentMessage.key.id,
      chatId: chatId,
      mediaType: mediaType,
      caption: caption || null,
    });

  } catch (error: any) {
    logger.error(`❌ Ошибка при отправке медиафайла в чат ${chatId}:`, error);
    res.status(500).json({ 
      error: 'Ошибка отправки медиафайла', 
      details: error.message 
    });
  }
};
