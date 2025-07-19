// src/routes/chatAssignmentRoutes.ts

import { Router } from 'express';
import {
  assignChatToOperator,
  unassignChat,
  getMyAssignedChats,
  getUnassignedChats,
  setChatPriority,
  closeChat,
} from '../controllers/chatAssignmentController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Применяем middleware аутентификации ко всем маршрутам
router.use(authMiddleware);

// Добавляем логирование для отладки
router.use((req, res, next) => {
  console.log(`🔥 CHAT-ASSIGNMENT ROUTE: ${req.method} ${req.path} - Base URL: ${req.baseUrl}`);
  console.log(`🔥 Full URL: ${req.originalUrl}`);
  console.log(`🔥 Params:`, req.params);
  console.log(`🔥 Body:`, req.body);
  next();
});

// Назначение чата оператору
router.post('/assign', assignChatToOperator);

// Снятие назначения чата
router.post('/unassign', unassignChat);

// Получение чатов, назначенных текущему пользователю
router.get('/my-assigned', getMyAssignedChats);

// Получение неназначенных чатов
router.get('/unassigned', getUnassignedChats);

// Изменение приоритета чата
router.post('/priority', setChatPriority);

// Закрытие чата
router.post('/close', closeChat);

export default router;
