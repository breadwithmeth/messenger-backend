"use strict";
// src/controllers/aiController.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.healthCheck = exports.getSuggestions = void 0;
const aiService_1 = require("../services/aiService");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
/**
 * GET /api/ai/suggestions/:chatId
 * Получает AI-предложения ответов для чата
 */
const getSuggestions = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const chatId = parseInt(req.params.chatId);
        const organizationId = res.locals.organizationId;
        const limit = parseInt(req.query.limit) || 3;
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
        const suggestions = yield (0, aiService_1.getSuggestedResponses)(chatId, organizationId, limit);
        logger.info(`[AI Controller] Получено ${suggestions.length} предложений для чата #${chatId}`);
        return res.status(200).json({
            success: true,
            chatId,
            suggestions,
            count: suggestions.length,
            timestamp: new Date().toISOString(),
        });
    }
    catch (error) {
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
});
exports.getSuggestions = getSuggestions;
/**
 * GET /api/ai/health
 * Проверка работоспособности AI сервиса
 */
const healthCheck = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        logger.info('[AI Controller] Проверка здоровья AI сервиса');
        const isHealthy = yield (0, aiService_1.checkAIServiceHealth)();
        if (isHealthy) {
            return res.status(200).json({
                status: 'healthy',
                service: 'DeepSeek AI',
                timestamp: new Date().toISOString(),
            });
        }
        else {
            return res.status(503).json({
                status: 'unhealthy',
                service: 'DeepSeek AI',
                timestamp: new Date().toISOString(),
            });
        }
    }
    catch (error) {
        logger.error('[AI Controller] Ошибка health check:', error);
        return res.status(503).json({
            status: 'unhealthy',
            service: 'DeepSeek AI',
            error: error.message,
            timestamp: new Date().toISOString(),
        });
    }
});
exports.healthCheck = healthCheck;
//# sourceMappingURL=aiController.js.map