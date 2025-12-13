// src/routes/mediaRoutes.ts

import { Router } from 'express';
import {
  uploadAndSendMedia,
  uploadMediaOnly,
  uploadSingle,
  sendMediaByChatId,
  uploadMediaForWABA
} from '../controllers/mediaController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Применяем middleware авторизации ко всем маршрутам
router.use(authMiddleware);

// Загрузить и отправить медиафайл
// POST /api/media/send
router.post('/send', uploadSingle, uploadAndSendMedia);

// Просто загрузить медиафайл (без отправки)
// POST /api/media/upload
router.post('/upload', uploadSingle, uploadMediaOnly);

// Загрузить медиафайл для использования в WABA (возвращает mediaUrl)
// POST /api/media/upload-for-waba
router.post('/upload-for-waba', uploadSingle, uploadMediaForWABA);

// Отправить медиафайл по chatId
// POST /api/media/send-by-chat
router.post('/send-by-chat', sendMediaByChatId);

export default router;
