"use strict";
// src/routes/aiRoutes.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const aiController_1 = require("../controllers/aiController");
const router = express_1.default.Router();
/**
 * GET /api/ai/suggestions/:chatId
 * Получает AI-предложения ответов для чата на основе истории за последний час
 *
 * Query params:
 * - limit: количество предложений (1-10, по умолчанию 3)
 */
router.get('/suggestions/:chatId', aiController_1.getSuggestions);
/**
 * GET /api/ai/health
 * Проверка работоспособности AI сервиса
 */
router.get('/health', aiController_1.healthCheck);
exports.default = router;
//# sourceMappingURL=aiRoutes.js.map