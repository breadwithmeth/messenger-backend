"use strict";
// src/routes/unreadRoutes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const unreadController_1 = require("../controllers/unreadController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Отладочное логирование
console.log('🔄 Загружаются unread маршруты...');
// Применяем middleware авторизации ко всем маршрутам
router.use(authMiddleware_1.authMiddleware);
// Добавляем логирование для всех запросов
router.use((req, res, next) => {
    console.log(`🔥 UNREAD ROUTE: ${req.method} ${req.path} - Base URL: ${req.baseUrl}`);
    console.log(`🔥 Full URL: ${req.originalUrl}`);
    console.log(`🔥 Params:`, req.params);
    next();
});
// Отметить сообщения как прочитанные
// POST /api/unread/:chatId/mark-read
router.post('/:chatId/mark-read', unreadController_1.markMessagesAsRead);
// Отметить весь чат как прочитанный
// POST /api/unread/:chatId/mark-chat-read
router.post('/:chatId/mark-chat-read', unreadController_1.markChatAsRead);
// Получить статистику непрочитанных сообщений
// GET /api/unread/counts
router.get('/counts', unreadController_1.getUnreadCounts);
// Получить чаты с непрочитанными сообщениями
// GET /api/unread/chats
router.get('/chats', unreadController_1.getChatsWithUnread);
console.log('✅ Unread маршруты загружены успешно');
exports.default = router;
//# sourceMappingURL=unreadRoutes.js.map