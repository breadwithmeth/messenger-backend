"use strict";
// src/routes/messageReadRoutes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const messageReadController_1 = require("../controllers/messageReadController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Применяем middleware аутентификации ко всем маршрутам
router.use(authMiddleware_1.authMiddleware);
// Добавляем логирование для всех запросов
router.use((req, res, next) => {
    console.log(`🔥 MESSAGE-READ ROUTE: ${req.method} ${req.path} - Base URL: ${req.baseUrl}`);
    console.log(`🔥 Full URL: ${req.originalUrl}`);
    console.log(`🔥 Params:`, req.params);
    next();
});
// Отметка сообщений в чате как прочитанных
router.post('/:chatId/read', messageReadController_1.markMessagesAsRead);
// Альтернативный эндпоинт для отметки сообщений как прочитанных
router.post('/:chatId/mark-read', messageReadController_1.markMessagesAsRead);
// Отметка сообщений в тикете как прочитанных (по номеру тикета)
router.post('/ticket/:ticketNumber/mark-read', messageReadController_1.markTicketMessagesAsRead);
// Получение количества непрочитанных сообщений
router.get('/unread-count', messageReadController_1.getUnreadCount);
// Получение статистики по сообщениям (для админов)
router.get('/stats', messageReadController_1.getMessageStats);
exports.default = router;
//# sourceMappingURL=messageReadRoutes.js.map