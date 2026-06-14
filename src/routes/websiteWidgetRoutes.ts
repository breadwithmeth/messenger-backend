import { Router } from 'express';
import {
  createWebsiteWidget,
  listWebsiteWidgets,
  rotateWebsiteWidgetKey,
  updateWebsiteWidget,
} from '../controllers/websiteWidgetController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);
router.get('/', listWebsiteWidgets);
router.post('/', createWebsiteWidget);
router.patch('/:widgetId', updateWebsiteWidget);
router.post('/:widgetId/rotate-key', rotateWebsiteWidgetKey);

export default router;
