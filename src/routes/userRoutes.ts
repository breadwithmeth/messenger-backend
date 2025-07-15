import { Router } from 'express';
import { createUser, getUsersByOrganization, getMe } from '../controllers/userController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

// Применяем middleware для всех маршрутов в этом файле
router.use(authMiddleware);

// Маршрут для создания нового пользователя (оператора)
// POST /api/users
router.post('/', createUser);

// Новый маршрут для получения списка пользователей
// GET /api/users
router.get('/all', getUsersByOrganization);

// Новый маршрут для получения информации о текущем пользователе
// GET /api/users/me
router.get('/me', getMe);

export default router;
