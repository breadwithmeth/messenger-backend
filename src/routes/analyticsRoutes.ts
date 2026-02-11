// src/routes/analyticsRoutes.ts

import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getChatAnalytics, getOperatorAnalytics } from '../controllers/analyticsController';

const router = Router();

router.use(authMiddleware);

// Аналитика по чатам (summary)
router.get('/chats', getChatAnalytics);

// Аналитика по операторам (summary)
router.get('/operators', getOperatorAnalytics);

export default router;
