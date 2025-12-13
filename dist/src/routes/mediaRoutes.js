"use strict";
// src/routes/mediaRoutes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const mediaController_1 = require("../controllers/mediaController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Применяем middleware авторизации ко всем маршрутам
router.use(authMiddleware_1.authMiddleware);
// Загрузить и отправить медиафайл
// POST /api/media/send
router.post('/send', mediaController_1.uploadSingle, mediaController_1.uploadAndSendMedia);
// Просто загрузить медиафайл (без отправки)
// POST /api/media/upload
router.post('/upload', mediaController_1.uploadSingle, mediaController_1.uploadMediaOnly);
// Загрузить медиафайл для использования в WABA (возвращает mediaUrl)
// POST /api/media/upload-for-waba
router.post('/upload-for-waba', mediaController_1.uploadSingle, mediaController_1.uploadMediaForWABA);
// Отправить медиафайл по chatId
// POST /api/media/send-by-chat
router.post('/send-by-chat', mediaController_1.sendMediaByChatId);
exports.default = router;
//# sourceMappingURL=mediaRoutes.js.map