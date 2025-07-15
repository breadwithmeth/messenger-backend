"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/accountRoutes.ts
const express_1 = require("express");
const accountController_1 = require("../controllers/accountController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authMiddleware);
// POST /api/accounts - Добавить новый аккаунт
router.post('/', accountController_1.createAccount);
exports.default = router;
//# sourceMappingURL=accountRoutes.js.map