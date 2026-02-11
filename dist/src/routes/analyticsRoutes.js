"use strict";
// src/routes/analyticsRoutes.ts
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const analyticsController_1 = require("../controllers/analyticsController");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authMiddleware);
// Аналитика по чатам (summary)
router.get('/chats', analyticsController_1.getChatAnalytics);
// Аналитика по операторам (summary)
router.get('/operators', analyticsController_1.getOperatorAnalytics);
exports.default = router;
//# sourceMappingURL=analyticsRoutes.js.map