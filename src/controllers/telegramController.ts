// src/controllers/telegramController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage.js';
import {
  startTelegramBot,
  stopTelegramBot,
  sendTelegramMessage,
  getTelegramBot,
} from '../services/telegramService.js';
import { createLogger } from '../config/logging.js';
import { chatVisibilityWhere, userCanAccessHrChats } from '../auth/hrAccess.js';

const logger = createLogger();

/**
 * Получить список всех ботов организации
 */
export async function listBots(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;

    const bots = await prisma.telegramBot.findMany({
      where: {
        organizationId: parseInt(organizationId),
      },
      orderBy: { createdAt: 'desc' },
    });

    res.json({ bots });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка получения списка ботов:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Получить информацию о конкретном боте
 */
export async function getBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;

    const bot = await prisma.telegramBot.findUnique({
      where: { id: parseInt(botId) },
      include: {
        organization: {
          select: {
            id: true,
            name: true,
          },
        },
      },
    });

    if (!bot) {
      res.status(404).json({ error: 'Бот не найден' });
      return;
    }

    // Проверяем, активен ли бот
    const isActive = getTelegramBot(bot.id) !== undefined;

    res.json({
      bot: {
        ...bot,
        isRunning: isActive,
      },
    });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка получения бота:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Создать нового бота
 */
export async function createBot(req: Request, res: Response): Promise<void> {
  try {
    const { organizationId } = req.params;
    const { botToken, welcomeMessage, autoStart, aiEnabled, aiModel, aiSystemPrompt } = req.body;

    if (!botToken) {
      res.status(400).json({ error: 'Не указан токен бота' });
      return;
    }

    // Проверяем, не существует ли уже бот с таким токеном
    const existingBot = await prisma.telegramBot.findFirst({
      where: { botToken },
    });

    if (existingBot) {
      res.status(400).json({ error: 'Бот с таким токеном уже существует' });
      return;
    }

    // Создаём бота в БД
    const bot = await prisma.telegramBot.create({
      data: {
        organizationId: parseInt(organizationId),
        botToken,
        welcomeMessage: welcomeMessage || undefined,
        aiEnabled: aiEnabled !== undefined ? Boolean(aiEnabled) : undefined,
        aiModel: aiModel || undefined,
        aiSystemPrompt: aiSystemPrompt || undefined,
        status: 'inactive',
      },
    });

    logger.info(`[Telegram API] Создан новый бот ID ${bot.id}`);

    // Автозапуск, если указано
    if (autoStart) {
      try {
        await startTelegramBot(bot.id);
      } catch (error: any) {
        logger.error(`[Telegram API] Ошибка автозапуска бота ID ${bot.id}:`, error);
        // Не фейлим весь запрос, просто логируем ошибку
      }
    }

    // Получаем обновлённые данные
    const updatedBot = await prisma.telegramBot.findUnique({
      where: { id: bot.id },
    });

    res.status(201).json({ bot: updatedBot });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка создания бота:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Обновить настройки бота
 */
export async function updateBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;
    const { botToken, welcomeMessage, autoReply, webhookUrl, aiEnabled, aiModel, aiSystemPrompt } = req.body;

    const bot = await prisma.telegramBot.findUnique({
      where: { id: parseInt(botId) },
    });

    if (!bot) {
      res.status(404).json({ error: 'Бот не найден' });
      return;
    }

    // Если меняется токен, нужно перезапустить бота
    const needsRestart = botToken && botToken !== bot.botToken;

    if (needsRestart) {
      // Останавливаем старого бота
      await stopTelegramBot(bot.id);
    }

    // Обновляем данные
    const updatedBot = await prisma.telegramBot.update({
      where: { id: parseInt(botId) },
      data: {
        botToken: botToken || undefined,
        welcomeMessage: welcomeMessage !== undefined ? welcomeMessage : undefined,
        autoReply: autoReply !== undefined ? autoReply : undefined,
        webhookUrl: webhookUrl !== undefined ? webhookUrl : undefined,
        aiEnabled: aiEnabled !== undefined ? Boolean(aiEnabled) : undefined,
        aiModel: aiModel !== undefined ? aiModel : undefined,
        aiSystemPrompt: aiSystemPrompt !== undefined ? aiSystemPrompt : undefined,
      },
    });

    // Перезапускаем, если был активен
    if (needsRestart && bot.status === 'active') {
      try {
        await startTelegramBot(updatedBot.id);
      } catch (error: any) {
        logger.error(`[Telegram API] Ошибка перезапуска бота ID ${botId}:`, error);
      }
    }

    res.json({ bot: updatedBot });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка обновления бота:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Удалить бота
 */
export async function deleteBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;

    const bot = await prisma.telegramBot.findUnique({
      where: { id: parseInt(botId) },
    });

    if (!bot) {
      res.status(404).json({ error: 'Бот не найден' });
      return;
    }

    // Останавливаем бота, если запущен
    await stopTelegramBot(bot.id);

    // Удаляем из БД
    await prisma.telegramBot.delete({
      where: { id: parseInt(botId) },
    });

    logger.info(`[Telegram API] Удалён бот ID ${botId}`);

    res.json({ success: true });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка удаления бота:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Запустить бота
 */
export async function startBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;

    await startTelegramBot(parseInt(botId));

    const bot = await prisma.telegramBot.findUnique({
      where: { id: parseInt(botId) },
    });

    res.json({ bot });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка запуска бота:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Остановить бота
 */
export async function stopBot(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;

    await stopTelegramBot(parseInt(botId));

    const bot = await prisma.telegramBot.findUnique({
      where: { id: parseInt(botId) },
    });

    res.json({ bot });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка остановки бота:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Отправить сообщение через бота
 */
export async function sendMessage(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;
    const { chatId, content, replyToMessageId } = req.body;
    const organizationId = res.locals.organizationId;
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    if (!chatId || !content) {
      res.status(400).json({ error: 'Не указаны chatId или content' });
      return;
    }

    // Получаем userId из res.locals (устанавливается middleware аутентификации)
    const userId = res.locals.userId;

    const existingChat = await prisma.chat.findFirst({
      where: {
        organizationId,
        channel: 'telegram',
        telegramBotId: parseInt(botId),
        telegramChatId: String(chatId),
      },
      select: {
        isHr: true,
      },
    });

    if (existingChat?.isHr && !canAccessHrChats) {
      res.status(404).json({ error: 'Чат не найден' });
      return;
    }

    const sent = await sendTelegramMessage(
      parseInt(botId),
      chatId,
      content,
      {
        replyToMessageId,
        userId,
      }
    );

    res.json({
      success: true,
      messageId: sent.message_id,
      timestamp: new Date(sent.date * 1000),
    });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка отправки сообщения:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Получить чаты Telegram бота
 */
export async function getBotChats(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;
    const { limit = 50, offset = 0, status } = req.query;
    const organizationId = res.locals.organizationId;
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    const where: any = {
      organizationId,
      channel: 'telegram',
      telegramBotId: parseInt(botId),
      ...chatVisibilityWhere(canAccessHrChats),
    };

    if (status && typeof status === 'string') {
      where.status = status;
    }

    const [chats, total] = await Promise.all([
      prisma.chat.findMany({
        where,
        orderBy: { lastMessageAt: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
        include: {
          assignedUser: {
            select: {
              id: true,
              name: true,
            },
          },
          _count: {
            select: { messages: true },
          },
        },
      }),
      prisma.chat.count({ where }),
    ]);

    res.json({
      chats,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка получения чатов бота:', error);
    res.status(500).json({ error: error.message });
  }
}

/**
 * Список доступных моделей AI-сервера (для настройки AI-ботов)
 */
export async function listAiModels(req: Request, res: Response): Promise<void> {
  try {
    const { listAiModels } = await import('../services/aiChatClient.js');
    const models = await listAiModels();
    res.json({ models });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка получения моделей AI:', error);
    res.status(502).json({ error: error.message });
  }
}

/**
 * Заказы, собранные AI-ботом
 */
export async function getBotOrders(req: Request, res: Response): Promise<void> {
  try {
    const { botId } = req.params;
    const { limit = 50, offset = 0, status } = req.query;
    const organizationId = res.locals.organizationId;

    // Заказы ищем по чатам этого бота (chat.telegramBotId)
    const where: any = {
      organizationId,
      chat: {
        telegramBotId: parseInt(botId),
      },
    };

    if (status && typeof status === 'string') {
      where.status = status;
    }

    const [orders, total] = await Promise.all([
      prisma.botOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: parseInt(limit as string),
        skip: parseInt(offset as string),
        include: {
          chat: {
            select: {
              id: true,
              name: true,
              telegramUsername: true,
              telegramFirstName: true,
              telegramLastName: true,
            },
          },
        },
      }),
      prisma.botOrder.count({ where }),
    ]);

    res.json({
      orders,
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error: any) {
    logger.error('[Telegram API] Ошибка получения заказов бота:', error);
    res.status(500).json({ error: error.message });
  }
}
