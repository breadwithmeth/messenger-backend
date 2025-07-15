"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const userController_1 = require("../controllers/userController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
// Применяем middleware для всех маршрутов в этом файле
router.use(authMiddleware_1.authMiddleware);
// Маршрут для создания нового пользователя (оператора)
// POST /api/users
router.post('/', userController_1.createUser);
// Новый маршрут для получения списка пользователей
// GET /api/users
router.get('/all', userController_1.getUsersByOrganization);
// Новый маршрут для получения информации о текущем пользователе
// GET /api/users/me
router.get('/me', userController_1.getMe);
exports.default = router;
//# sourceMappingURL=userRoutes.js.map