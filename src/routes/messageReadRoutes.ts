// src/routes/messageReadRoutes.ts

import { Router } from 'express';
import {
  markMessagesAsRead,
  getUnreadCount,
  getMessageStats,
  markTicketMessagesAsRead,
} from '../controllers/messageReadController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Применяем middleware аутентификации ко всем маршрутам
router.use(authMiddleware);

// Добавляем логирование для всех запросов
router.use((req, res, next) => {
  console.log(`🔥 MESSAGE-READ ROUTE: ${req.method} ${req.path} - Base URL: ${req.baseUrl}`);
  console.log(`🔥 Full URL: ${req.originalUrl}`);
  console.log(`🔥 Params:`, req.params);
  next();
});

// Отметка сообщений в чате как прочитанных
router.post('/:chatId/read', markMessagesAsRead);

// Альтернативный эндпоинт для отметки сообщений как прочитанных
router.post('/:chatId/mark-read', markMessagesAsRead);

// Отметка сообщений в тикете как прочитанных (по номеру тикета)
router.post('/ticket/:ticketNumber/mark-read', markTicketMessagesAsRead);

// Получение количества непрочитанных сообщений
router.get('/unread-count', getUnreadCount);

// Получение статистики по сообщениям (для админов)
router.get('/stats', getMessageStats);

export default router;
