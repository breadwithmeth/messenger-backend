"use strict";
// src/routes/wabaRoutes.ts
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const authMiddleware_1 = require("../middlewares/authMiddleware");
const wabaController_1 = require("../controllers/wabaController");
const router = express_1.default.Router();
// Webhook endpoints (не требуют авторизации)
router.get('/webhook', wabaController_1.verifyWebhook);
router.post('/webhook', wabaController_1.handleWebhook);
// Protected endpoints (требуют авторизации)
router.post('/send', authMiddleware_1.authMiddleware, wabaController_1.sendMessage);
router.get('/templates', authMiddleware_1.authMiddleware, wabaController_1.getTemplates);
exports.default = router;
//# sourceMappingURL=wabaRoutes.js.map