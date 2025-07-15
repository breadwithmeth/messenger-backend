"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const waSessionController_1 = require("../controllers/waSessionController");
const router = (0, express_1.Router)();
// Запуск новой сессии WhatsApp для организации и номера телефона
router.post('/start', waSessionController_1.startSessionHandler);
// // Получение всех сессий по организации
// router.get('/sessions/:organizationId', getSessionsHandler);
// // Получение QR-кода для сессии
// router.get('/qr', getQrHandler);
exports.default = router;
