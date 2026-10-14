// src/routes/analyticsRoutes.ts

import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { getChatAnalytics, getOperatorAnalytics, listAnalyticsTickets } from '../controllers/analyticsController.js';

const router = Router();

router.use(authMiddleware);

// Аналитика по чатам (summary)
router.get('/chats', getChatAnalytics);

// Аналитика по операторам (summary)
router.get('/operators', getOperatorAnalytics);

// Список «тикетов» (сессий) по активности сообщений
router.get('/tickets', listAnalyticsTickets);

export default router;
