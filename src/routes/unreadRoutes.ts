// src/routes/unreadRoutes.ts

import { Router } from 'express';
import {
  markMessagesAsRead,
  markChatAsRead,
  getUnreadCounts,
  getChatsWithUnread
} from '../controllers/unreadController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Отладочное логирование
console.log('🔄 Загружаются unread маршруты...');

// Применяем middleware авторизации ко всем маршрутам
router.use(authMiddleware);

// Добавляем логирование для всех запросов
router.use((req, res, next) => {
  console.log(`🔥 UNREAD ROUTE: ${req.method} ${req.path} - Base URL: ${req.baseUrl}`);
  console.log(`🔥 Full URL: ${req.originalUrl}`);
  console.log(`🔥 Params:`, req.params);
  next();
});

// Отметить сообщения как прочитанные
// POST /api/unread/:chatId/mark-read
router.post('/:chatId/mark-read', markMessagesAsRead);

// Отметить весь чат как прочитанный
// POST /api/unread/:chatId/mark-chat-read
router.post('/:chatId/mark-chat-read', markChatAsRead);

// Получить статистику непрочитанных сообщений
// GET /api/unread/counts
router.get('/counts', getUnreadCounts);

// Получить чаты с непрочитанными сообщениями
// GET /api/unread/chats
router.get('/chats', getChatsWithUnread);

console.log('✅ Unread маршруты загружены успешно');

export default router;
