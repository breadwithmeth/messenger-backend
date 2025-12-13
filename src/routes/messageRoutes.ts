// src/routes/messageRoutes.ts

import { Router } from 'express';
import { sendTextMessage, sendMediaMessage, sendMessageByTicket, sendMessageByChat } from '../controllers/messageController';
import { authMiddleware } from '../middlewares/authMiddleware'; // Импортируем middleware

const router = Router();

// Маршрут для отправки текстовых сообщений
// Применяем authMiddleware, чтобы убедиться, что только авторизованные пользователи могут отправлять сообщения
router.post('/send-text', authMiddleware, sendTextMessage);

// Маршрут для отправки медиа-сообщений
// Также защищен authMiddleware
router.post('/send-media', authMiddleware, sendMediaMessage);

// Маршрут для отправки сообщения по номеру тикета
// Упрощенный API - нужен только ticketNumber и text
router.post('/send-by-ticket', authMiddleware, sendMessageByTicket);

// Универсальный маршрут для отправки сообщений по chatId
// Автоматически определяет тип подключения (Baileys или WABA)
router.post('/send-by-chat', authMiddleware, sendMessageByChat);

export default router;