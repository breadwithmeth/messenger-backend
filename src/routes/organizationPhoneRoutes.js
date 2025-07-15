"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/organizationPhoneRoutes.ts
const express_1 = require("express");
const organizationPhoneController_1 = require("../controllers/organizationPhoneController"); // Путь к вашему контроллеру
const authMiddleware_1 = require("../middlewares/authMiddleware"); // Путь к вашему middleware аутентификации
const router = (0, express_1.Router)();
// Применяем middleware аутентификации ко всем маршрутам роутера
// Это гарантирует, что res.locals.organizationId будет доступен в контроллерах
router.use(authMiddleware_1.authMiddleware);
// Маршруты для управления номерами организации
// POST /api/organization-phones - Добавить новый номер
router.post('/', organizationPhoneController_1.createOrganizationPhone);
// GET /api/organization-phones - Получить список всех номеров
router.get('/all', organizationPhoneController_1.listOrganizationPhones);
// POST /api/organization-phones/:organizationPhoneId/connect - Инициировать подключение номера (получение QR)
router.post('/:organizationPhoneId/connect', organizationPhoneController_1.connectOrganizationPhone);
// DELETE /api/organization-phones/:organizationPhoneId/disconnect - Отключить номер (выйти из сессии)
router.delete('/:organizationPhoneId/disconnect', organizationPhoneController_1.disconnectOrganizationPhone);
exports.default = router;
