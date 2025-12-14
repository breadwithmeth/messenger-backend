// src/controllers/aiController.ts

import { Request, Response } from 'express';
import { getSuggestedResponses, checkAIServiceHealth } from '../services/aiService';
import pino from 'pino';

const logger = pino({ level: 'info' });

/**
 * GET /api/ai/suggestions/:chatId
 * Получает AI-предложения ответов для чата
 */
export const getSuggestions = async (req: Request, res: Response) => {
  try {
    const chatId = parseInt(req.params.chatId);
    const organizationId = res.locals.organizationId;
    const limit = parseInt(req.query.limit as string) || 3;

    // Валидация
    if (isNaN(chatId) || chatId <= 0) {
      return res.status(400).json({
        error: 'Некорректный chatId',
      });
    }

    if (limit < 1 || limit > 10) {
      return res.status(400).json({
        error: 'Параметр limit должен быть от 1 до 10',
      });
    }

    logger.info(`[AI Controller] Запрос предложений для чата #${chatId}, limit=${limit}`);

    // Получаем предложения от AI
    const suggestions = await getSuggestedResponses(chatId, organizationId, limit);

    logger.info(`[AI Controller] Получено ${suggestions.length} предложений для чата #${chatId}`);

    return res.status(200).json({
      success: true,
      chatId,
      suggestions,
      count: suggestions.length,
      timestamp: new Date().toISOString(),
    });

  } catch (error: any) {
    logger.error('[AI Controller] Ошибка получения предложений:', error);

    // Специфичные ошибки
    if (error.message.includes('Чат не найден')) {
      return res.status(404).json({
        error: 'Чат не найден',
      });
    }

    return res.status(500).json({
      error: 'Не удалось получить предложения ответов',
      details: error.message,
    });
  }
};

/**
 * GET /api/ai/health
 * Проверка работоспособности AI сервиса
 */
export const healthCheck = async (req: Request, res: Response) => {
  try {
    logger.info('[AI Controller] Проверка здоровья AI сервиса');

    const isHealthy = await checkAIServiceHealth();

    if (isHealthy) {
      return res.status(200).json({
        status: 'healthy',
        service: 'DeepSeek AI',
        timestamp: new Date().toISOString(),
      });
    } else {
      return res.status(503).json({
        status: 'unhealthy',
        service: 'DeepSeek AI',
        timestamp: new Date().toISOString(),
      });
    }

  } catch (error: any) {
    logger.error('[AI Controller] Ошибка health check:', error);

    return res.status(503).json({
      status: 'unhealthy',
      service: 'DeepSeek AI',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
};
