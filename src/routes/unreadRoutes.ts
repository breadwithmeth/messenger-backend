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

// Применяем middleware авторизации ко всем маршрутам
router.use(authMiddleware);

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

export default router;
