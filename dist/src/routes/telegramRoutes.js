"use strict";
// src/routes/telegramRoutes.ts
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const telegramController = __importStar(require("../controllers/telegramController"));
const router = (0, express_1.Router)();
/**
 * Управление ботами
 */
// GET /api/telegram/organizations/:organizationId/bots - Список ботов организации
router.get('/organizations/:organizationId/bots', telegramController.listBots);
// GET /api/telegram/bots/:botId - Информация о боте
router.get('/bots/:botId', telegramController.getBot);
// POST /api/telegram/organizations/:organizationId/bots - Создать бота
router.post('/organizations/:organizationId/bots', telegramController.createBot);
// PUT /api/telegram/bots/:botId - Обновить бота
router.put('/bots/:botId', telegramController.updateBot);
// DELETE /api/telegram/bots/:botId - Удалить бота
router.delete('/bots/:botId', telegramController.deleteBot);
/**
 * Управление состоянием бота
 */
// POST /api/telegram/bots/:botId/start - Запустить бота
router.post('/bots/:botId/start', telegramController.startBot);
// POST /api/telegram/bots/:botId/stop - Остановить бота
router.post('/bots/:botId/stop', telegramController.stopBot);
/**
 * Отправка сообщений
 */
// POST /api/telegram/bots/:botId/messages - Отправить сообщение через бота
router.post('/bots/:botId/messages', telegramController.sendMessage);
/**
 * Чаты
 */
// GET /api/telegram/bots/:botId/chats - Получить чаты бота
router.get('/bots/:botId/chats', telegramController.getBotChats);
exports.default = router;
//# sourceMappingURL=telegramRoutes.js.map