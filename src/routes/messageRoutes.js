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
// router.post('/send-media', authMiddleware, sendMediaMessage);
exports.default = router;
