// src/routes/analyticsRoutes.ts

import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import { getChatAnalytics } from '../controllers/analyticsController';

const router = Router();

router.use(authMiddleware);

// Аналитика по чатам (summary)
router.get('/chats', getChatAnalytics);

export default router;
