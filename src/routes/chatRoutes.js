"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// // src/routes/chatRoutes.ts
const express_1 = require("express");
const chatController_1 = require("../controllers/chatController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authMiddleware);
router.get('/', chatController_1.listChats);
router.get('/:chatId/messages', chatController_1.getChatMessages); // Получить сообщения из конкретного чата
exports.default = router;
