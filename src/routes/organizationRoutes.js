"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// src/routes/organizationRoutes.ts
const express_1 = require("express");
const organizationController_1 = require("../controllers/organizationController");
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = (0, express_1.Router)();
router.use(authMiddleware_1.authMiddleware);
router.post('/', organizationController_1.createOrganization);
router.get('/', organizationController_1.listOrganizations);
exports.default = router;
