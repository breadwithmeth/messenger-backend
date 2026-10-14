// src/routes/contactRoutes.ts
import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import { getContactProfile } from '../controllers/contactController.js';

const router = Router();
router.use(authMiddleware);

// GET /api/chats/:remoteJid/profile?organizationPhoneId=...
router.get('/chats/:remoteJid/profile', getContactProfile);

export default router;
