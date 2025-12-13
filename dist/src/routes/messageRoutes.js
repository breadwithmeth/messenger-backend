"use strict";
// src/routes/messageRoutes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const messageController_1 = require("../controllers/messageController");
const authMiddleware_1 = require("../middlewares/authMiddleware"); // Импортируем middleware
const router = (0, express_1.Router)();
// Маршрут для отправки текстовых сообщений
// Применяем authMiddleware, чтобы убедиться, что только авторизованные пользователи могут отправлять сообщения
router.post('/send-text', authMiddleware_1.authMiddleware, messageController_1.sendTextMessage);
// Маршрут для отправки медиа-сообщений
// Также защищен authMiddleware
router.post('/send-media', authMiddleware_1.authMiddleware, messageController_1.sendMediaMessage);
// Маршрут для отправки сообщения по номеру тикета
// Упрощенный API - нужен только ticketNumber и text
router.post('/send-by-ticket', authMiddleware_1.authMiddleware, messageController_1.sendMessageByTicket);
// Универсальный маршрут для отправки сообщений по chatId
// Автоматически определяет тип подключения (Baileys или WABA)
router.post('/send-by-chat', authMiddleware_1.authMiddleware, messageController_1.sendMessageByChat);
exports.default = router;
//# sourceMappingURL=messageRoutes.js.map