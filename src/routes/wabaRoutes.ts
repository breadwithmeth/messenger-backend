// src/routes/wabaRoutes.ts

import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  verifyWebhook,
  handleWebhook,
  sendMessage,
  broadcastTemplate,
  getDiagnostics,
  getTemplates,
  getWabaLogs,
  operatorSendMessage,
  getMessageStatus,
  getChatMessages,
} from '../controllers/wabaController';

const router = express.Router();

// Webhook endpoints (не требуют авторизации)
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);

// Protected endpoints (требуют авторизации)
router.post('/send', authMiddleware, sendMessage);
router.post('/broadcast-template', authMiddleware, broadcastTemplate);
router.get('/diagnostics', authMiddleware, getDiagnostics);
router.get('/templates', authMiddleware, getTemplates);
router.get('/logs', authMiddleware, getWabaLogs);

// Operator API (для операторов)
router.post('/operator/send', authMiddleware, operatorSendMessage);
router.get('/operator/message-status/:messageId', authMiddleware, getMessageStatus);
router.get('/operator/chat/:chatId/messages', authMiddleware, getChatMessages);

export default router;
