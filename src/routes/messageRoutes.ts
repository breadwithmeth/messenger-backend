// src/routes/messageRoutes.ts

import { Router } from 'express';
import { sendTextMessage,  } from '../controllers/messageController';
import { authMiddleware } from '../middlewares/authMiddleware'; // Импортируем middleware

const router = Router();

// Маршрут для отправки текстовых сообщений
// Применяем authMiddleware, чтобы убедиться, что только авторизованные пользователи могут отправлять сообщения
router.post('/send-text', authMiddleware, sendTextMessage);

// Маршрут для отправки медиа-сообщений
// Также защищен authMiddleware
// router.post('/send-media', authMiddleware, sendMediaMessage);

export default router;