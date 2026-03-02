// src/routes/accountRoutes.ts
import { Router } from 'express';
import { createAccount } from '../controllers/accountController';
import { authMiddleware } from '../middlewares/authMiddleware';
import { requireRole } from '../middlewares/requireRole';

const router = Router();

router.use(authMiddleware);
router.use(requireRole(['manager', 'admin']));

// POST /api/accounts - Добавить новый аккаунт
router.post('/', createAccount);

export default router;
