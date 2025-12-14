// src/routes/aiRoutes.ts

import express from 'express';
import { getSuggestions, healthCheck } from '../controllers/aiController';

const router = express.Router();

/**
 * GET /api/ai/suggestions/:chatId
 * Получает AI-предложения ответов для чата на основе истории за последний час
 * 
 * Query params:
 * - limit: количество предложений (1-10, по умолчанию 3)
 */
router.get('/suggestions/:chatId', getSuggestions);

/**
 * GET /api/ai/health
 * Проверка работоспособности AI сервиса
 */
router.get('/health', healthCheck);

export default router;
