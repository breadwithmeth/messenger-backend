import { Router } from 'express';
import { startSessionHandler,  } from '../controllers/waSessionController';

const router = Router();

// Запуск новой сессии WhatsApp для организации и номера телефона
router.post('/start', startSessionHandler);

// // Получение всех сессий по организации
// router.get('/sessions/:organizationId', getSessionsHandler);

// // Получение QR-кода для сессии
// router.get('/qr', getQrHandler);

export default router;
