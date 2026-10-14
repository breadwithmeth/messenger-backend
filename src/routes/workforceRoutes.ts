import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware.js';
import {
  getMyEmployee,
  getMyActivityStats,
  listEmployees,
  listMyShifts,
  setMyPresence,
  startMyShift,
  stopMyShift,
  setEmployeePresenceInternal,
  presenceHeartbeat,
} from '../controllers/workforceController.js';
import { requireRole } from '../middlewares/requireRole.js';
import { serviceAuthMiddleware } from '../middlewares/serviceAuthMiddleware.js';

const router = Router();

router.use(authMiddleware);

router.get('/me', getMyEmployee);
router.get('/me/activity', getMyActivityStats);
router.post('/shifts/start', startMyShift);
router.post('/shifts/stop', stopMyShift);
router.get('/shifts', listMyShifts);
router.patch('/presence', setMyPresence);
router.post('/presence/heartbeat', presenceHeartbeat);

// Internal service endpoint (requires service token with employee-service-access)
router.patch('/internal/employees/:id/presence', serviceAuthMiddleware, setEmployeePresenceInternal);

// Админский сценарий (опционально)
router.get('/employees', requireRole(['admin', 'manager']), listEmployees);

export default router;
