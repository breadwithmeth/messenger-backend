import { Router } from 'express';
import {
  createSession,
  getWidgetConfig,
  listSessionMessages,
  sendSessionMessage,
} from '../controllers/websiteWidgetPublicController';
import {
  authenticateWebsiteSession,
  loadWebsiteWidget,
  websiteWidgetCors,
  websiteWidgetRateLimit,
} from '../middlewares/websiteWidgetMiddleware';

const router = Router();

router.use('/:publicKey', loadWebsiteWidget, websiteWidgetCors);
router.get('/:publicKey/config', getWidgetConfig);
router.post(
  '/:publicKey/sessions',
  websiteWidgetRateLimit({ scope: 'session', max: 120, windowMs: 60 * 1000 }),
  createSession
);
router.get(
  '/:publicKey/sessions/:sessionId/messages',
  authenticateWebsiteSession,
  websiteWidgetRateLimit({ scope: 'history', max: 120, windowMs: 60 * 1000 }),
  listSessionMessages
);
router.post(
  '/:publicKey/sessions/:sessionId/messages',
  authenticateWebsiteSession,
  websiteWidgetRateLimit({ scope: 'message', max: 30, windowMs: 60 * 1000 }),
  sendSessionMessage
);

export default router;
