// src/routes/accountRoutes.ts
import { Router } from 'express';
import { createAccount } from '../controllers/accountController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

// POST /api/accounts - Добавить новый аккаунт
router.post('/', createAccount);

export default router;
