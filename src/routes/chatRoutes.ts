// // src/routes/chatRoutes.ts
import { Router } from 'express';
import {  listChats,getChatMessages } from '../controllers/chatController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/', listChats);
router.get('/:chatId/messages', getChatMessages); // Получить сообщения из конкретного чата

export default router;
