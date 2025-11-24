// src/routes/telegramRoutes.ts

import { Router } from 'express';
import * as telegramController from '../controllers/telegramController';

const router = Router();

/**
 * Управление ботами
 */

// GET /api/telegram/organizations/:organizationId/bots - Список ботов организации
router.get('/organizations/:organizationId/bots', telegramController.listBots);

// GET /api/telegram/bots/:botId - Информация о боте
router.get('/bots/:botId', telegramController.getBot);

// POST /api/telegram/organizations/:organizationId/bots - Создать бота
router.post('/organizations/:organizationId/bots', telegramController.createBot);

// PUT /api/telegram/bots/:botId - Обновить бота
router.put('/bots/:botId', telegramController.updateBot);

// DELETE /api/telegram/bots/:botId - Удалить бота
router.delete('/bots/:botId', telegramController.deleteBot);

/**
 * Управление состоянием бота
 */

// POST /api/telegram/bots/:botId/start - Запустить бота
router.post('/bots/:botId/start', telegramController.startBot);

// POST /api/telegram/bots/:botId/stop - Остановить бота
router.post('/bots/:botId/stop', telegramController.stopBot);

/**
 * Отправка сообщений
 */

// POST /api/telegram/bots/:botId/messages - Отправить сообщение через бота
router.post('/bots/:botId/messages', telegramController.sendMessage);

/**
 * Чаты
 */

// GET /api/telegram/bots/:botId/chats - Получить чаты бота
router.get('/bots/:botId/chats', telegramController.getBotChats);

export default router;
