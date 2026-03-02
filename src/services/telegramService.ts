// src/services/telegramService.ts

import TelegramBot from 'node-telegram-bot-api';
import { prisma } from '../config/authStorage';
import pino from 'pino';

const logger = pino({ level: 'info' });

// Хранилище активных ботов
const activeBots = new Map<number, TelegramBot>();

/**
 * Запускает Telegram бота
 */
export async function startTelegramBot(botId: number): Promise<void> {
  try {
    // Получаем данные бота из БД
    const bot = await prisma.telegramBot.findUnique({
      where: { id: botId },
      include: { organization: true },
    });

    if (!bot) {
      throw new Error(`Telegram бот с ID ${botId} не найден`);
    }

    if (activeBots.has(botId)) {
      logger.info(`[Telegram] Бот ${bot.botUsername} уже запущен`);
      return;
    }

    // Создаём экземпляр бота
    const telegram = new TelegramBot(bot.botToken, {
      polling: true,
    });

    // Сохраняем экземпляр
    activeBots.set(botId, telegram);

    logger.info(`[Telegram] Запуск бота ${bot.botUsername} (ID: ${botId})`);

    // Получаем информацию о боте
    const botInfo = await telegram.getMe();
    
    // Обновляем информацию в БД
    await prisma.telegramBot.update({
      where: { id: botId },
      data: {
        botUsername: botInfo.username,
        botName: `${botInfo.first_name || ''}`,
        botId: botInfo.id.toString(),
        status: 'active',
        lastActiveAt: new Date(),
      },
    });

    logger.info(`[Telegram] Бот @${botInfo.username} успешно запущен`);

    // === ОБРАБОТЧИКИ СОБЫТИЙ ===

    // Обработка команды /start
    telegram.onText(/\/start/, async (msg) => {
      await handleStartCommand(telegram, msg, bot.organizationId, botId);
    });

    // Обработка текстовых сообщений
    telegram.on('message', async (msg) => {
      // Пропускаем команды (они обрабатываются отдельно)
      if (msg.text?.startsWith('/')) return;

      await handleIncomingMessage(telegram, msg, bot.organizationId, botId);
    });

    // Обработка фото
    telegram.on('photo', async (msg) => {
      await handleIncomingMessage(telegram, msg, bot.organizationId, botId);
    });

    // Обработка документов
    telegram.on('document', async (msg) => {
      await handleIncomingMessage(telegram, msg, bot.organizationId, botId);
    });

    // Обработка видео
    telegram.on('video', async (msg) => {
      await handleIncomingMessage(telegram, msg, bot.organizationId, botId);
    });

    // Обработка голосовых сообщений
    telegram.on('voice', async (msg) => {
      await handleIncomingMessage(telegram, msg, bot.organizationId, botId);
    });

    // Обработка ошибок
    telegram.on('polling_error', (error) => {
      logger.error(`[Telegram] Ошибка polling для бота ID ${botId}:`, error);
    });

    telegram.on('error', async (error) => {
      logger.error(`[Telegram] Ошибка бота ID ${botId}:`, error);
      
      // Обновляем статус в БД
      await prisma.telegramBot.update({
        where: { id: botId },
        data: { status: 'error' },
      });
    });

  } catch (error: any) {
    logger.error(`[Telegram] Ошибка запуска бота ID ${botId}:`, error);
    
    // Обновляем статус в БД
    await prisma.telegramBot.update({
      where: { id: botId },
      data: { status: 'error' },
    });
    
    throw error;
  }
}

/**
 * Останавливает Telegram бота
 */
export async function stopTelegramBot(botId: number): Promise<void> {
  const telegram = activeBots.get(botId);
  
  if (!telegram) {
    logger.warn(`[Telegram] Бот ID ${botId} не запущен`);
    return;
  }

  try {
    await telegram.stopPolling();
    activeBots.delete(botId);

    await prisma.telegramBot.update({
      where: { id: botId },
      data: { status: 'inactive' },
    });

    logger.info(`[Telegram] Бот ID ${botId} остановлен`);
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка остановки бота ID ${botId}:`, error);
    throw error;
  }
}

/**
 * Получает экземпляр активного бота
 */
export function getTelegramBot(botId: number): TelegramBot | undefined {
  return activeBots.get(botId);
}

/**
 * Обработка команды /start
 */
async function handleStartCommand(
  telegram: TelegramBot,
  msg: TelegramBot.Message,
  organizationId: number,
  botId: number
): Promise<void> {
  try {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString();
    const username = msg.from?.username;
    const firstName = msg.from?.first_name;
    const lastName = msg.from?.last_name;

    logger.info(`[Telegram] /start от пользователя ${username || userId} в чате ${chatId}`);

    // Создаём или находим чат
    await ensureTelegramChat(
      organizationId,
      botId,
      chatId,
      userId,
      username,
      firstName,
      lastName
    );

    // Получаем приветственное сообщение
    const bot = await prisma.telegramBot.findUnique({
      where: { id: botId },
    });

    const welcomeMessage = bot?.welcomeMessage || 
      `👋 Привет! Я бот поддержки. Напишите ваш вопрос, и я передам его оператору.`;

    await telegram.sendMessage(chatId, welcomeMessage);
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка обработки /start:`, error);
  }
}

/**
 * Обработка входящего сообщения
 */
async function handleIncomingMessage(
  telegram: TelegramBot,
  msg: TelegramBot.Message,
  organizationId: number,
  botId: number
): Promise<void> {
  try {
    const chatId = msg.chat.id.toString();
    const userId = msg.from?.id.toString();
    const username = msg.from?.username;
    const firstName = msg.from?.first_name;
    const lastName = msg.from?.last_name;
    const messageId = msg.message_id;

    // Создаём или находим чат
    const chat = await ensureTelegramChat(
      organizationId,
      botId,
      chatId,
      userId,
      username,
      firstName,
      lastName
    );

    // --- АВТОМАТИЧЕСКОЕ СОЗДАНИЕ КЛИЕНТА (ВРЕМЕННО ОТКЛЮЧЕНО) ---
    // try {
    //   logger.info(`👤 Проверка клиента Telegram для UserID: ${userId}...`);
    //   const { ensureTelegramClient, linkClientToChat } = await import('./clientService');
    //   if (userId) {
    //     const client = await ensureTelegramClient(
    //       organizationId,
    //       userId,
    //       username,
    //       firstName,
    //       lastName
    //     );
    //     logger.info(`✅ Клиент Telegram обработан: ${client.name} (ID: ${client.id})`);
    //     
    //     // Связываем клиента с чатом
    //     await linkClientToChat(client.id, chat.id);
    //     logger.info(`🔗 Клиент #${client.id} связан с Telegram чатом #${chat.id}`);
    //   } else {
    //     logger.warn(`⚠️ Отсутствует userId для создания клиента Telegram`);
    //   }
    // } catch (clientError) {
    //   logger.error(`⚠️ Ошибка при создании клиента Telegram для ${username || userId}:`, clientError);
    //   // Продолжаем обработку сообщения даже если создание клиента не удалось
    // }

    // Определяем тип и содержимое сообщения
    let messageType = 'text';
    let content = '';
    let mediaUrl: string | undefined;
    let filename: string | undefined;
    let mimeType: string | undefined;
    let size: number | undefined;

    if (msg.text) {
      messageType = 'text';
      content = msg.text;
    } else if (msg.photo && msg.photo.length > 0) {
      messageType = 'image';
      content = msg.caption || '';
      const photo = msg.photo[msg.photo.length - 1]; // Берём фото лучшего качества
      size = photo.file_size;
      // Скачиваем и сохраняем в хранилище
      try {
        const fileLink = await telegram.getFileLink(photo.file_id);
        const response = await fetch(fileLink);
        const buffer = Buffer.from(await response.arrayBuffer());
        
        const { saveMedia } = await import('./storageService');
        mediaUrl = await saveMedia(buffer, `telegram-${photo.file_id}.jpg`, 'image/jpeg');
        mimeType = 'image/jpeg';
      } catch (e) {
        logger.error('[Telegram] Ошибка сохранения фото:', e);
      }
    } else if (msg.document) {
      messageType = 'document';
      content = msg.caption || '';
      filename = msg.document.file_name;
      mimeType = msg.document.mime_type;
      size = msg.document.file_size;
      try {
        const fileLink = await telegram.getFileLink(msg.document.file_id);
        const response = await fetch(fileLink);
        const buffer = Buffer.from(await response.arrayBuffer());
        
        const { saveMedia } = await import('./storageService');
        mediaUrl = await saveMedia(buffer, filename || `telegram-${msg.document.file_id}`, mimeType || 'application/octet-stream');
      } catch (e) {
        logger.error('[Telegram] Ошибка сохранения документа:', e);
      }
    } else if (msg.video) {
      messageType = 'video';
      content = msg.caption || '';
      mimeType = msg.video.mime_type;
      size = msg.video.file_size;
      try {
        const fileLink = await telegram.getFileLink(msg.video.file_id);
        const response = await fetch(fileLink);
        const buffer = Buffer.from(await response.arrayBuffer());
        
        const { saveMedia } = await import('./storageService');
        mediaUrl = await saveMedia(buffer, `telegram-${msg.video.file_id}.mp4`, mimeType || 'video/mp4');
      } catch (e) {
        logger.error('[Telegram] Ошибка сохранения видео:', e);
      }
    } else if (msg.voice) {
      messageType = 'audio';
      mimeType = msg.voice.mime_type;
      size = msg.voice.file_size;
      try {
        const fileLink = await telegram.getFileLink(msg.voice.file_id);
        const response = await fetch(fileLink);
        const buffer = Buffer.from(await response.arrayBuffer());
        
        const { saveMedia } = await import('./storageService');
        mediaUrl = await saveMedia(buffer, `telegram-${msg.voice.file_id}.ogg`, mimeType || 'audio/ogg');
      } catch (e) {
        logger.error('[Telegram] Ошибка сохранения голосового:', e);
      }
    }

    // Сохраняем сообщение в БД
    const hasResponsible = Boolean(chat.assignedUserId);

    const savedMessage = await prisma.message.create({
      data: {
        organizationId,
        channel: 'telegram',
        telegramBotId: botId,
        telegramMessageId: messageId,
        telegramChatId: chatId,
        telegramUserId: userId,
        telegramUsername: username,
        chatId: chat.id,
        fromMe: false,
        content,
        type: messageType,
        mediaUrl,
        filename,
        mimeType,
        size,
        timestamp: new Date(msg.date * 1000),
        status: 'delivered',
      },
    });

    // Обновляем чат
    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        lastMessageAt: new Date(),
        unreadCount: { increment: 1 },
      },
    });

    logger.info(`[Telegram] Сохранено входящее сообщение от ${username || userId} в чат #${chat.id}`);

    // Отправляем Socket.IO уведомление о новом сообщении
    const { notifyNewMessage } = await import('./socketService');
    try {
      notifyNewMessage(organizationId, {
        id: savedMessage.id,
        chatId: savedMessage.chatId,
        content: savedMessage.content,
        type: savedMessage.type,
        mediaUrl: savedMessage.mediaUrl,
        filename: savedMessage.filename,
        fromMe: savedMessage.fromMe,
        timestamp: savedMessage.timestamp,
        status: savedMessage.status,
        telegramUsername: savedMessage.telegramUsername,
        channel: 'telegram',
        hasResponsible,
      });
    } catch (socketError) {
      logger.error('[Socket.IO] Ошибка отправки уведомления Telegram:', socketError);
    }
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка обработки входящего сообщения:`, error);
  }
}

/**
 * Создаёт или находит чат в Telegram
 */
async function ensureTelegramChat(
  organizationId: number,
  telegramBotId: number,
  telegramChatId: string,
  telegramUserId?: string,
  telegramUsername?: string,
  telegramFirstName?: string,
  telegramLastName?: string
): Promise<any> {
  try {
    // Пытаемся найти существующий чат
    let chat = await prisma.chat.findFirst({
      where: {
        organizationId,
        channel: 'telegram',
        telegramBotId,
        telegramChatId,
      },
    });

    if (!chat) {
      // Генерируем номер тикета
      const lastTicket = await prisma.chat.findFirst({
        where: {
          organizationId,
          ticketNumber: { not: null },
        },
        orderBy: { ticketNumber: 'desc' },
        select: { ticketNumber: true },
      });

      const nextTicketNumber = (lastTicket?.ticketNumber || 0) + 1;

      // Создаём новый чат
      chat = await prisma.chat.create({
        data: {
          organizationId,
          channel: 'telegram',
          telegramBotId,
          telegramChatId,
          telegramUserId,
          telegramUsername,
          telegramFirstName,
          telegramLastName,
          name: telegramUsername || `${telegramFirstName || ''} ${telegramLastName || ''}`.trim() || `User ${telegramUserId}`,
          ticketNumber: nextTicketNumber,
          status: 'new',
          priority: 'normal',
          lastMessageAt: new Date(),
        },
      });

      await prisma.ticketHistory.create({
        data: {
          chatId: chat.id,
          changeType: 'ticket_created',
          newValue: String(nextTicketNumber),
          description: `Создан тикет #${nextTicketNumber}`,
        },
      });

      logger.info(`[Telegram] Создан новый чат #${chat.id} для ${telegramUsername || telegramUserId}, тикет #${nextTicketNumber}`);
    } else if (chat.status === 'closed' || chat.status === 'resolved') {
      // Клиент снова написал после закрытия/решения — открываем новый тикет
      const lastTicket = await prisma.chat.findFirst({
        where: {
          organizationId,
          ticketNumber: { not: null },
        },
        orderBy: { ticketNumber: 'desc' },
        select: { ticketNumber: true },
      });

      const nextTicketNumber = (lastTicket?.ticketNumber || 0) + 1;
      const previousTicketNumber = chat.ticketNumber;

      chat = await prisma.chat.update({
        where: { id: chat.id },
        data: {
          ticketNumber: nextTicketNumber,
          status: 'new',
          priority: 'normal',
          assignedUserId: null,
          assignedAt: null,
          closedAt: null,
          resolvedAt: null,
          lastMessageAt: new Date(),
        },
      });

      await prisma.ticketHistory.create({
        data: {
          chatId: chat.id,
          changeType: 'ticket_reopened',
          oldValue: previousTicketNumber ? String(previousTicketNumber) : null,
          newValue: String(nextTicketNumber),
          description: `Чат переоткрыт: новый тикет #${nextTicketNumber}${previousTicketNumber ? ` (был #${previousTicketNumber})` : ''}`,
        },
      });

      logger.info(`[Telegram] Чат #${chat.id} переоткрыт новым тикетом #${nextTicketNumber} после входящего сообщения`);
    }

    return chat;
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка создания/поиска чата:`, error);
    throw error;
  }
}

/**
 * Отправка сообщения через Telegram бота
 */
export async function sendTelegramMessage(
  botId: number,
  chatId: string,
  content: string,
  options?: {
    replyToMessageId?: number;
    userId?: number;
  }
): Promise<TelegramBot.Message> {
  const telegram = getTelegramBot(botId);

  if (!telegram) {
    throw new Error(`Telegram бот ID ${botId} не активен`);
  }

  try {
    const sendOptions: TelegramBot.SendMessageOptions = {};
    
    if (options?.replyToMessageId) {
      sendOptions.reply_to_message_id = options.replyToMessageId;
    }

    const sent = await telegram.sendMessage(chatId, content, sendOptions);

    // Сохраняем отправленное сообщение в БД
    const chat = await prisma.chat.findFirst({
      where: {
        channel: 'telegram',
        telegramBotId: botId,
        telegramChatId: chatId,
      },
    });

    if (chat) {
      await prisma.message.create({
        data: {
          organizationId: chat.organizationId,
          channel: 'telegram',
          telegramBotId: botId,
          telegramMessageId: sent.message_id,
          telegramChatId: chatId,
          chatId: chat.id,
          fromMe: true,
          content,
          type: 'text',
          timestamp: new Date(sent.date * 1000),
          status: 'sent',
          senderUserId: options?.userId,
        },
      });

      // Обновляем время последнего сообщения
      await prisma.chat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });

      logger.info(`[Telegram] Отправлено сообщение в чат ${chatId}, сохранено с senderUserId: ${options?.userId || 'не указан'}`);
    }

    logger.info(`[Telegram] Отправлено сообщение в чат ${chatId}`);
    return sent;
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка отправки сообщения:`, error);
    throw error;
  }
}

/**
 * Отправка фото через Telegram бота
 */
export async function sendTelegramPhoto(
  botId: number,
  chatId: string,
  photoUrl: string,
  caption?: string,
  options?: {
    replyToMessageId?: number;
    userId?: number;
  }
): Promise<TelegramBot.Message> {
  const telegram = getTelegramBot(botId);

  if (!telegram) {
    throw new Error(`Telegram бот ID ${botId} не активен`);
  }

  try {
    const sendOptions: TelegramBot.SendPhotoOptions = {};
    
    if (caption) {
      sendOptions.caption = caption;
    }
    
    if (options?.replyToMessageId) {
      sendOptions.reply_to_message_id = options.replyToMessageId;
    }

    const sent = await telegram.sendPhoto(chatId, photoUrl, sendOptions);

    // Сохраняем в БД
    const chat = await prisma.chat.findFirst({
      where: {
        channel: 'telegram',
        telegramBotId: botId,
        telegramChatId: chatId,
      },
    });

    if (chat) {
      await prisma.message.create({
        data: {
          organizationId: chat.organizationId,
          channel: 'telegram',
          telegramBotId: botId,
          telegramMessageId: sent.message_id,
          telegramChatId: chatId,
          chatId: chat.id,
          fromMe: true,
          content: caption || '',
          type: 'image',
          mediaUrl: photoUrl,
          timestamp: new Date(sent.date * 1000),
          status: 'sent',
          senderUserId: options?.userId,
        },
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });

      logger.info(`[Telegram] Отправлено фото в чат ${chatId}`);
    }

    return sent;
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка отправки фото:`, error);
    throw error;
  }
}

/**
 * Отправка документа через Telegram бота
 */
export async function sendTelegramDocument(
  botId: number,
  chatId: string,
  documentUrl: string,
  caption?: string,
  options?: {
    replyToMessageId?: number;
    userId?: number;
    filename?: string;
  }
): Promise<TelegramBot.Message> {
  const telegram = getTelegramBot(botId);

  if (!telegram) {
    throw new Error(`Telegram бот ID ${botId} не активен`);
  }

  try {
    const sendOptions: TelegramBot.SendDocumentOptions = {};
    
    if (caption) {
      sendOptions.caption = caption;
    }
    
    if (options?.replyToMessageId) {
      sendOptions.reply_to_message_id = options.replyToMessageId;
    }

    const sent = await telegram.sendDocument(chatId, documentUrl, sendOptions);

    // Сохраняем в БД
    const chat = await prisma.chat.findFirst({
      where: {
        channel: 'telegram',
        telegramBotId: botId,
        telegramChatId: chatId,
      },
    });

    if (chat) {
      await prisma.message.create({
        data: {
          organizationId: chat.organizationId,
          channel: 'telegram',
          telegramBotId: botId,
          telegramMessageId: sent.message_id,
          telegramChatId: chatId,
          chatId: chat.id,
          fromMe: true,
          content: caption || '',
          type: 'document',
          mediaUrl: documentUrl,
          filename: options?.filename,
          timestamp: new Date(sent.date * 1000),
          status: 'sent',
          senderUserId: options?.userId,
        },
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });

      logger.info(`[Telegram] Отправлен документ в чат ${chatId}`);
    }

    return sent;
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка отправки документа:`, error);
    throw error;
  }
}

/**
 * Отправка видео через Telegram бота
 */
export async function sendTelegramVideo(
  botId: number,
  chatId: string,
  videoUrl: string,
  caption?: string,
  options?: {
    replyToMessageId?: number;
    userId?: number;
  }
): Promise<TelegramBot.Message> {
  const telegram = getTelegramBot(botId);

  if (!telegram) {
    throw new Error(`Telegram бот ID ${botId} не активен`);
  }

  try {
    const sendOptions: TelegramBot.SendVideoOptions = {};
    
    if (caption) {
      sendOptions.caption = caption;
    }
    
    if (options?.replyToMessageId) {
      sendOptions.reply_to_message_id = options.replyToMessageId;
    }

    const sent = await telegram.sendVideo(chatId, videoUrl, sendOptions);

    // Сохраняем в БД
    const chat = await prisma.chat.findFirst({
      where: {
        channel: 'telegram',
        telegramBotId: botId,
        telegramChatId: chatId,
      },
    });

    if (chat) {
      await prisma.message.create({
        data: {
          organizationId: chat.organizationId,
          channel: 'telegram',
          telegramBotId: botId,
          telegramMessageId: sent.message_id,
          telegramChatId: chatId,
          chatId: chat.id,
          fromMe: true,
          content: caption || '',
          type: 'video',
          mediaUrl: videoUrl,
          timestamp: new Date(sent.date * 1000),
          status: 'sent',
          senderUserId: options?.userId,
        },
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });

      logger.info(`[Telegram] Отправлено видео в чат ${chatId}`);
    }

    return sent;
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка отправки видео:`, error);
    throw error;
  }
}

/**
 * Отправка аудио через Telegram бота
 */
export async function sendTelegramAudio(
  botId: number,
  chatId: string,
  audioUrl: string,
  caption?: string,
  options?: {
    replyToMessageId?: number;
    userId?: number;
  }
): Promise<TelegramBot.Message> {
  const telegram = getTelegramBot(botId);

  if (!telegram) {
    throw new Error(`Telegram бот ID ${botId} не активен`);
  }

  try {
    const sendOptions: TelegramBot.SendAudioOptions = {};
    
    if (caption) {
      sendOptions.caption = caption;
    }
    
    if (options?.replyToMessageId) {
      sendOptions.reply_to_message_id = options.replyToMessageId;
    }

    const sent = await telegram.sendAudio(chatId, audioUrl, sendOptions);

    // Сохраняем в БД
    const chat = await prisma.chat.findFirst({
      where: {
        channel: 'telegram',
        telegramBotId: botId,
        telegramChatId: chatId,
      },
    });

    if (chat) {
      await prisma.message.create({
        data: {
          organizationId: chat.organizationId,
          channel: 'telegram',
          telegramBotId: botId,
          telegramMessageId: sent.message_id,
          telegramChatId: chatId,
          chatId: chat.id,
          fromMe: true,
          content: caption || '',
          type: 'audio',
          mediaUrl: audioUrl,
          timestamp: new Date(sent.date * 1000),
          status: 'sent',
          senderUserId: options?.userId,
        },
      });

      await prisma.chat.update({
        where: { id: chat.id },
        data: { lastMessageAt: new Date() },
      });

      logger.info(`[Telegram] Отправлено аудио в чат ${chatId}`);
    }

    return sent;
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка отправки аудио:`, error);
    throw error;
  }
}

/**
 * Запускает все активные боты организации
 */
export async function startAllTelegramBots(): Promise<void> {
  try {
    const bots = await prisma.telegramBot.findMany({
      where: {
        status: { in: ['active', 'inactive'] },
      },
    });

    logger.info(`[Telegram] Найдено ${bots.length} ботов для запуска`);

    for (const bot of bots) {
      try {
        await startTelegramBot(bot.id);
      } catch (error: any) {
        logger.error(`[Telegram] Ошибка запуска бота ID ${bot.id}:`, error);
      }
    }
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка запуска всех ботов:`, error);
  }
}

/**
 * Останавливает все боты
 */
export async function stopAllTelegramBots(): Promise<void> {
  try {
    const botIds = Array.from(activeBots.keys());
    
    for (const botId of botIds) {
      try {
        await stopTelegramBot(botId);
      } catch (error: any) {
        logger.error(`[Telegram] Ошибка остановки бота ID ${botId}:`, error);
      }
    }
  } catch (error: any) {
    logger.error(`[Telegram] Ошибка остановки всех ботов:`, error);
  }
}
