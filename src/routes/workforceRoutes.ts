import { Router } from 'express';
import { authMiddleware } from '../middlewares/authMiddleware';
import {
  getMyEmployee,
  listEmployees,
  listMyShifts,
  setMyPresence,
  startMyShift,
  stopMyShift,
  setEmployeePresenceInternal,
  presenceHeartbeat,
} from '../controllers/workforceController';
import { requireRole } from '../middlewares/requireRole';
import { serviceAuthMiddleware } from '../middlewares/serviceAuthMiddleware';

const router = Router();

router.use(authMiddleware);

router.get('/me', getMyEmployee);
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
