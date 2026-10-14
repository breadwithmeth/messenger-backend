// src/routes/accountRoutes.ts
import { Router } from 'express';
import { createAccount } from '../controllers/accountController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { requireRole } from '../middlewares/requireRole.js';

const router = Router();

router.use(authMiddleware);
router.use(requireRole(['manager', 'admin']));

// POST /api/accounts - Добавить новый аккаунт
router.post('/', createAccount);

export default router;
