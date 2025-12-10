// src/controllers/wabaController.ts

import { Request, Response } from 'express';
import { createWABAService } from '../services/wabaService';
import { prisma } from '../config/authStorage';
import { ensureChat } from '../config/baileys';
import pino from 'pino';

const logger = pino({ level: 'info' });

interface AuthRequest extends Request {
  user?: {
    id: number;
    organizationId: number;
  };
}

/**
 * Webhook verification для WhatsApp Business API
 * GET /api/waba/webhook
 */
export const verifyWebhook = async (req: Request, res: Response) => {
  try {
    const mode = req.query['hub.mode'];
    const token = req.query['hub.verify_token'];
    const challenge = req.query['hub.challenge'];

    logger.info('🔍 WABA: Webhook verification request', { 
      mode, 
      receivedToken: token,
      challenge,
      expectedToken: process.env.WABA_VERIFY_TOKEN 
    });

    // Получаем verify token из параметра или переменной окружения
    const expectedToken = process.env.WABA_VERIFY_TOKEN || 'your_verify_token';

    if (mode === 'subscribe' && token === expectedToken) {
      logger.info('✅ WABA: Webhook verification successful');
      return res.status(200).send(challenge);
    } else {
      logger.warn('⚠️ WABA: Webhook verification failed', {
        modeMatch: mode === 'subscribe',
        tokenMatch: token === expectedToken
      });
      return res.sendStatus(403);
    }
  } catch (error) {
    logger.error('❌ WABA: Webhook verification error:', error);
    return res.sendStatus(500);
  }
};

/**
 * Обработка входящих webhook событий от WhatsApp Business API
 * POST /api/waba/webhook
 */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const body = req.body;

    // Быстро отвечаем 200 OK
    res.sendStatus(200);

    // Обрабатываем webhook асинхронно
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          await processWebhookChange(change);
        }
      }
    }
  } catch (error) {
    logger.error('❌ WABA: Webhook processing error:', error);
  }
};

/**
 * Обработка изменений из webhook
 */
async function processWebhookChange(change: any) {
  try {
    const value = change.value;
    if (!value) return;

    const phoneNumberId = value.metadata?.phone_number_id;
    const displayPhoneNumber = value.metadata?.display_phone_number;
    if (!phoneNumberId) return;

    // Находим или создаём организационный телефон по WABA phoneNumberId
    let orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        wabaPhoneNumberId: phoneNumberId,
        connectionType: 'waba',
      },
    });

    if (!orgPhone) {
      logger.info(`🆕 WABA: Auto-creating OrganizationPhone for phoneNumberId: ${phoneNumberId}`);
      
      // Получаем первую организацию или создаём дефолтную
      let organization = await prisma.organization.findFirst();
      
      if (!organization) {
        logger.info('🆕 WABA: Creating default organization');
        organization = await prisma.organization.create({
          data: {
            name: 'Default Organization',
          },
        });
      }

      // Создаём новый OrganizationPhone с данными из webhook
      orgPhone = await prisma.organizationPhone.create({
        data: {
          organizationId: organization.id,
          displayName: `WABA ${displayPhoneNumber || phoneNumberId}`,
          phoneJid: `${displayPhoneNumber?.replace(/^\+/, '') || phoneNumberId}@s.whatsapp.net`,
          status: 'connected',
          connectionType: 'waba',
          wabaPhoneNumberId: phoneNumberId,
          wabaAccessToken: process.env.WABA_ACCESS_TOKEN || null,
          wabaId: process.env.WABA_ID || null,
          wabaApiVersion: 'v21.0',
          wabaVerifyToken: process.env.WABA_VERIFY_TOKEN || null,
          lastConnectedAt: new Date(),
        },
      });
      
      logger.info(`✅ WABA: Created OrganizationPhone id=${orgPhone.id} for ${displayPhoneNumber}`);
    }

    // Обработка статусов сообщений
    if (value.statuses) {
      for (const status of value.statuses) {
        await handleMessageStatus(orgPhone.id, status);
      }
    }

    // Обработка входящих сообщений
    if (value.messages) {
      for (const message of value.messages) {
        await handleIncomingMessage(orgPhone, message);
      }
    }
  } catch (error) {
    logger.error('❌ WABA: Change processing error:', error);
  }
}

/**
 * Обработка статуса сообщения (delivered, read, etc.)
 */
async function handleMessageStatus(organizationPhoneId: number, status: any) {
  try {
    const wabaMessageId = status.id;
    const newStatus = status.status; // sent, delivered, read, failed

    await prisma.message.updateMany({
      where: {
        whatsappMessageId: wabaMessageId,
        organizationPhoneId,
      },
      data: {
        status: newStatus,
      },
    });

    logger.info(`📊 WABA: Message ${wabaMessageId} status updated to ${newStatus}`);
  } catch (error) {
    logger.error('❌ WABA: Status update error:', error);
  }
}

/**
 * Обработка входящего сообщения
 */
async function handleIncomingMessage(orgPhone: any, message: any) {
  try {
    // Нормализуем номер в формат WhatsApp JID
    const phoneNumber = message.from;
    const remoteJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
    const wabaMessageId = message.id;
    const timestamp = new Date(parseInt(message.timestamp) * 1000);

    // Определяем тип сообщения и контент
    let content = '';
    let messageType = 'text';
    let mediaUrl: string | undefined;
    let filename: string | undefined;
    let mimeType: string | undefined;

    if (message.type === 'text') {
      content = message.text?.body || '';
      messageType = 'text';
    } else if (message.type === 'image') {
      content = message.image?.caption || '';
      messageType = 'image';
      mimeType = message.image?.mime_type;
      // Здесь можно загрузить изображение с серверов WhatsApp
    } else if (message.type === 'document') {
      content = message.document?.caption || '';
      messageType = 'document';
      filename = message.document?.filename;
      mimeType = message.document?.mime_type;
    } else if (message.type === 'audio') {
      messageType = 'audio';
      mimeType = message.audio?.mime_type;
    } else if (message.type === 'video') {
      content = message.video?.caption || '';
      messageType = 'video';
      mimeType = message.video?.mime_type;
    } else if (message.type === 'button') {
      content = message.button?.text || '';
      messageType = 'button';
    } else if (message.type === 'interactive') {
      if (message.interactive?.type === 'button_reply') {
        content = message.interactive.button_reply.title;
        messageType = 'interactive_button';
      } else if (message.interactive?.type === 'list_reply') {
        content = message.interactive.list_reply.title;
        messageType = 'interactive_list';
      }
    }

    // Логируем входящее сообщение
    logger.info(`📥 WABA: Входящее [${messageType}]: "${content}" от ${remoteJid}`);

    // Создаём или находим чат
    const chatId = await ensureChat(
      orgPhone.organizationId,
      orgPhone.id,
      orgPhone.phoneJid,
      remoteJid,
      message.profile?.name
    );

    // Сохраняем сообщение в БД
    await prisma.message.create({
      data: {
        chatId,
        organizationPhoneId: orgPhone.id,
        organizationId: orgPhone.organizationId,
        channel: 'whatsapp',
        whatsappMessageId: wabaMessageId,
        receivingPhoneJid: orgPhone.phoneJid,
        remoteJid,
        senderJid: remoteJid,
        fromMe: false,
        content,
        type: messageType,
        mediaUrl,
        filename,
        mimeType,
        timestamp,
        status: 'received',
        isReadByOperator: false,
      },
    });

    // Увеличиваем счётчик непрочитанных
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        unreadCount: { increment: 1 },
        lastMessageAt: timestamp,
      },
    });

    logger.info(`💾 WABA: Message saved to DB (chatId: ${chatId})`);
  } catch (error) {
    logger.error('❌ WABA: Incoming message processing error:', error);
  }
}

/**
 * Отправка сообщения через WABA
 * POST /api/waba/send
 */
export const sendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationPhoneId, to, message, type = 'text' } = req.body;

    if (!organizationPhoneId || !to || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Проверяем права доступа
    const orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        id: organizationPhoneId,
        organizationId: req.user?.organizationId,
        connectionType: 'waba',
      },
    });

    if (!orgPhone) {
      return res.status(404).json({ error: 'Organization phone not found or not configured for WABA' });
    }

    const wabaService = await createWABAService(organizationPhoneId);
    if (!wabaService) {
      return res.status(500).json({ 
        error: 'WABA service not configured',
        details: 'wabaAccessToken is missing in database. Please update OrganizationPhone with your permanent System User Access Token from Meta.',
        organizationPhoneId: organizationPhoneId
      });
    }

    // Отправляем сообщение
    let result;
    let messageContent = '';
    let mediaUrl: string | null = null;
    
    switch (type) {
      case 'text':
        result = await wabaService.sendTextMessage(to, message);
        messageContent = message;
        break;
        
      case 'image':
        if (!message.link) {
          return res.status(400).json({ error: 'image.link is required' });
        }
        result = await wabaService.sendImage(to, message.link, message.caption);
        messageContent = message.caption || '';
        mediaUrl = message.link;
        break;
        
      case 'document':
        if (!message.link) {
          return res.status(400).json({ error: 'document.link is required' });
        }
        result = await wabaService.sendDocument(to, message.link, message.filename, message.caption);
        messageContent = message.caption || message.filename || '';
        mediaUrl = message.link;
        break;
        
      case 'video':
        if (!message.link) {
          return res.status(400).json({ error: 'video.link is required' });
        }
        result = await wabaService.sendMessage({
          to,
          type: 'video',
          video: {
            link: message.link,
            caption: message.caption,
          },
        });
        messageContent = message.caption || '';
        mediaUrl = message.link;
        break;
        
      case 'audio':
        if (!message.link) {
          return res.status(400).json({ error: 'audio.link is required' });
        }
        result = await wabaService.sendMessage({
          to,
          type: 'audio',
          audio: {
            link: message.link,
          },
        });
        messageContent = 'Audio message';
        mediaUrl = message.link;
        break;
        
      case 'interactive':
        result = await wabaService.sendMessage({
          to,
          type: 'interactive',
          interactive: message,
        });
        messageContent = message.body?.text || JSON.stringify(message);
        break;
        
      case 'template':
        result = await wabaService.sendTemplateMessage(to, message.name, message.language, message.components);
        messageContent = `Template: ${message.name}`;
        break;
        
      default:
        return res.status(400).json({ error: `Unsupported message type: ${type}. Supported: text, image, document, video, audio, interactive, template` });
    }

    // Нормализуем номер получателя в формат WhatsApp JID
    const remoteJid = to.includes('@') ? to : `${to}@s.whatsapp.net`;

    // Сохраняем отправленное сообщение в БД
    const chatId = await ensureChat(
      orgPhone.organizationId,
      orgPhone.id,
      orgPhone.phoneJid,
      remoteJid,
      undefined
    );

    await prisma.message.create({
      data: {
        chatId,
        organizationPhoneId,
        organizationId: orgPhone.organizationId,
        channel: 'whatsapp',
        whatsappMessageId: result.messages?.[0]?.id,
        receivingPhoneJid: orgPhone.phoneJid,
        remoteJid: remoteJid,
        senderJid: orgPhone.phoneJid,
        fromMe: true,
        content: messageContent,
        mediaUrl: mediaUrl,
        type,
        timestamp: new Date(),
        status: 'sent',
        senderUserId: req.user?.id,
        isReadByOperator: true,
      },
    });

    res.json({ success: true, messageId: result.messages?.[0]?.id, data: result });
  } catch (error: any) {
    logger.error('❌ WABA: Send message error:', error);
    
    // Более детальная информация об ошибке
    const errorMessage = error.response?.data?.error?.message || error.message;
    const errorDetails = error.response?.data || {};
    
    res.status(500).json({ 
      error: errorMessage,
      details: errorDetails,
      type: error.response?.data?.error?.type
    });
  }
};

/**
 * Отправка сообщения оператором (упрощённый API)
 * POST /api/waba/operator/send
 */
export const operatorSendMessage = async (req: AuthRequest, res: Response) => {
  try {
    const { chatId, message, type = 'text', mediaUrl, caption, filename } = req.body;

    if (!chatId || !message) {
      return res.status(400).json({ error: 'chatId and message are required' });
    }

    // Получаем чат с проверкой доступа
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        organizationId: req.user?.organizationId,
      },
      include: {
        organizationPhone: true,
      },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chat.organizationPhone.connectionType !== 'waba') {
      return res.status(400).json({ error: 'This chat is not using WABA' });
    }

    const wabaService = await createWABAService(chat.organizationPhoneId);
    if (!wabaService) {
      return res.status(500).json({ 
        error: 'WABA service not configured',
        details: 'wabaAccessToken is missing'
      });
    }

    // Отправляем сообщение в зависимости от типа
    let result;
    const recipientPhone = chat.remoteJid.replace('@s.whatsapp.net', '');

    switch (type) {
      case 'text':
        result = await wabaService.sendTextMessage(recipientPhone, message);
        break;
      case 'image':
        if (!mediaUrl) {
          return res.status(400).json({ error: 'mediaUrl is required for image type' });
        }
        result = await wabaService.sendImage(recipientPhone, mediaUrl, caption);
        break;
      case 'document':
        if (!mediaUrl) {
          return res.status(400).json({ error: 'mediaUrl is required for document type' });
        }
        result = await wabaService.sendDocument(recipientPhone, mediaUrl, filename, caption);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported message type. Use: text, image, document' });
    }

    // Сохраняем в БД
    const savedMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhoneId,
        organizationId: chat.organizationId,
        channel: 'whatsapp',
        whatsappMessageId: result.messages?.[0]?.id,
        receivingPhoneJid: chat.organizationPhone.phoneJid,
        remoteJid: chat.remoteJid,
        senderJid: chat.organizationPhone.phoneJid,
        fromMe: true,
        content: type === 'text' ? message : caption || '',
        mediaUrl: mediaUrl || null,
        type: type,
        timestamp: new Date(),
        status: 'sent',
        senderUserId: req.user?.id,
        isReadByOperator: true,
      },
    });

    // Обновляем lastMessageAt в чате
    await prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessageAt: new Date() },
    });

    logger.info(`📤 WABA Operator: Message sent by user ${req.user?.id} to chat ${chatId}`);

    res.json({ 
      success: true, 
      messageId: result.messages?.[0]?.id,
      message: savedMessage
    });
  } catch (error: any) {
    logger.error('❌ WABA Operator: Send message error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Получение статуса доставки сообщения
 * GET /api/waba/operator/message-status/:messageId
 */
export const getMessageStatus = async (req: AuthRequest, res: Response) => {
  try {
    const { messageId } = req.params;

    const message = await prisma.message.findFirst({
      where: {
        id: parseInt(messageId),
        organizationId: req.user?.organizationId,
      },
      select: {
        id: true,
        whatsappMessageId: true,
        status: true,
        timestamp: true,
        content: true,
        fromMe: true,
        chat: {
          select: {
            id: true,
            remoteJid: true,
          },
        },
      },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({
      id: message.id,
      whatsappMessageId: message.whatsappMessageId,
      status: message.status,
      timestamp: message.timestamp,
      delivered: ['delivered', 'read'].includes(message.status || ''),
      read: message.status === 'read',
    });
  } catch (error: any) {
    logger.error('❌ WABA: Get message status error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Получение истории сообщений чата с WABA статусами
 * GET /api/waba/operator/chat/:chatId/messages
 */
export const getChatMessages = async (req: AuthRequest, res: Response) => {
  try {
    const { chatId } = req.params;
    const { limit = '50', offset = '0' } = req.query;

    const chat = await prisma.chat.findFirst({
      where: {
        id: parseInt(chatId),
        organizationId: req.user?.organizationId,
      },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messages = await prisma.message.findMany({
      where: { chatId: chat.id },
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      select: {
        id: true,
        whatsappMessageId: true,
        content: true,
        mediaUrl: true,
        type: true,
        fromMe: true,
        timestamp: true,
        status: true,
        isReadByOperator: true,
        senderUser: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    const total = await prisma.message.count({
      where: { chatId: chat.id },
    });

    res.json({
      messages: messages.map(msg => ({
        ...msg,
        delivered: ['delivered', 'read'].includes(msg.status || ''),
        read: msg.status === 'read',
      })),
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error: any) {
    logger.error('❌ WABA: Get chat messages error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Получение списка шаблонов сообщений
 * GET /api/waba/templates
 */
export const getTemplates = async (req: AuthRequest, res: Response) => {
  try {
    const { organizationPhoneId } = req.query;

    if (!organizationPhoneId) {
      return res.status(400).json({ error: 'organizationPhoneId is required' });
    }

    const wabaService = await createWABAService(Number(organizationPhoneId));
    if (!wabaService) {
      return res.status(500).json({ error: 'WABA service not configured' });
    }

    // Здесь можно добавить получение шаблонов через Graph API
    // const templates = await wabaService.getTemplates();

    res.json({ templates: [] });
  } catch (error: any) {
    logger.error('❌ WABA: Get templates error:', error);
    res.status(500).json({ error: error.message });
  }
};
