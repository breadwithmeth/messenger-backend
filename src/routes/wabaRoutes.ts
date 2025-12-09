// src/routes/wabaRoutes.ts

import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  verifyWebhook,
  handleWebhook,
  sendMessage,
  getTemplates,
} from '../controllers/wabaController';

const router = express.Router();

// Webhook endpoints (не требуют авторизации)
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);

// Protected endpoints (требуют авторизации)
router.post('/send', authMiddleware, sendMessage);
router.get('/templates', authMiddleware, getTemplates);

export default router;
