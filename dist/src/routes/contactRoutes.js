"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/contactRoutes.ts
const express_1 = require("express");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const contactController_1 = require("../controllers/contactController");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authMiddleware);
// GET /api/chats/:remoteJid/profile?organizationPhoneId=...
router.get('/chats/:remoteJid/profile', contactController_1.getContactProfile);
exports.default = router;
//# sourceMappingURL=contactRoutes.js.map