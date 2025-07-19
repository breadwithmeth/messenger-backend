"use strict";
// src/routes/chatAssignmentRoutes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const chatAssignmentController_1 = require("../controllers/chatAssignmentController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Применяем middleware аутентификации ко всем маршрутам
router.use(authMiddleware_1.authMiddleware);
// Добавляем логирование для отладки
router.use((req, res, next) => {
    console.log(`🔥 CHAT-ASSIGNMENT ROUTE: ${req.method} ${req.path} - Base URL: ${req.baseUrl}`);
    console.log(`🔥 Full URL: ${req.originalUrl}`);
    console.log(`🔥 Params:`, req.params);
    console.log(`🔥 Body:`, req.body);
    next();
});
// Назначение чата оператору
router.post('/assign', chatAssignmentController_1.assignChatToOperator);
// Снятие назначения чата
router.post('/unassign', chatAssignmentController_1.unassignChat);
// Получение чатов, назначенных текущему пользователю
router.get('/my-assigned', chatAssignmentController_1.getMyAssignedChats);
// Получение неназначенных чатов
router.get('/unassigned', chatAssignmentController_1.getUnassignedChats);
// Изменение приоритета чата
router.post('/priority', chatAssignmentController_1.setChatPriority);
// Закрытие чата
router.post('/close', chatAssignmentController_1.closeChat);
exports.default = router;
//# sourceMappingURL=chatAssignmentRoutes.js.map