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

    // Получаем verify token из параметра или переменной окружения
    const expectedToken = process.env.WABA_VERIFY_TOKEN || 'your_verify_token';

    if (mode === 'subscribe' && token === expectedToken) {
      logger.info('✅ WABA: Webhook verification successful');
      res.status(200).send(challenge);
    } else {
      logger.warn('⚠️ WABA: Webhook verification failed');
      res.sendStatus(403);
    }
  } catch (error) {
    logger.error('❌ WABA: Webhook verification error:', error);
    res.sendStatus(500);
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
    if (!phoneNumberId) return;

    // Находим организационный телефон по WABA phoneNumberId
    const orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        wabaPhoneNumberId: phoneNumberId,
        connectionType: 'waba',
      },
    });

    if (!orgPhone) {
      logger.warn(`⚠️ WABA: OrganizationPhone not found for phoneNumberId: ${phoneNumberId}`);
      return;
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
    const remoteJid = message.from; // Номер отправителя
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
      return res.status(500).json({ error: 'WABA service not configured' });
    }

    // Отправляем сообщение
    let result;
    switch (type) {
      case 'text':
        result = await wabaService.sendTextMessage(to, message);
        break;
      case 'template':
        result = await wabaService.sendTemplateMessage(to, message.name, message.language, message.components);
        break;
      default:
        return res.status(400).json({ error: 'Unsupported message type' });
    }

    // Сохраняем отправленное сообщение в БД
    const chatId = await ensureChat(
      orgPhone.organizationId,
      orgPhone.id,
      orgPhone.phoneJid,
      to,
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
        remoteJid: to,
        senderJid: orgPhone.phoneJid,
        fromMe: true,
        content: type === 'text' ? message : JSON.stringify(message),
        type,
        timestamp: new Date(),
        status: 'sent',
        senderUserId: req.user?.id,
        isReadByOperator: true,
      },
    });

    res.json({ success: true, messageId: result.messages?.[0]?.id });
  } catch (error: any) {
    logger.error('❌ WABA: Send message error:', error);
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
