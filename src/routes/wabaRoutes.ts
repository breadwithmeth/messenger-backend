// src/routes/wabaRoutes.ts

import express from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  verifyWebhook,
  handleWebhook,
  sendMessage,
  broadcastTemplate,
  getBroadcastTemplateJob,
  getDiagnostics,
  getTemplates,
  getWabaLogs,
  operatorSendMessage,
  getMessageStatus,
  getChatMessages,
  createCollectionFlow,
  sendFlow,
  getFlowInfo,
  getFlowSubmissions,
} from '../controllers/wabaController.js';

const router = express.Router();

// Webhook endpoints (не требуют авторизации)
router.get('/webhook', verifyWebhook);
router.post('/webhook', handleWebhook);

// Protected endpoints (требуют авторизации)
router.post('/send', authMiddleware, sendMessage);
router.post('/broadcast-template', authMiddleware, broadcastTemplate);
router.get('/broadcast-template/jobs/:jobId', authMiddleware, getBroadcastTemplateJob);
router.get('/diagnostics', authMiddleware, getDiagnostics);
router.get('/templates', authMiddleware, getTemplates);
router.get('/logs', authMiddleware, getWabaLogs);

// WhatsApp Flows (форма сбора данных: Имя, Город, Адрес, Тип оплаты)
router.post('/flow/create', authMiddleware, createCollectionFlow);
router.post('/flow/send', authMiddleware, sendFlow);
router.get('/flow', authMiddleware, getFlowInfo);
router.get('/flow/submissions', authMiddleware, getFlowSubmissions);

// Operator API (для операторов)
router.post('/operator/send', authMiddleware, operatorSendMessage);
router.get('/operator/message-status/:messageId', authMiddleware, getMessageStatus);
router.get('/operator/chat/:chatId/messages', authMiddleware, getChatMessages);

export default router;
