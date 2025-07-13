// src/routes/organizationRoutes.ts
import { Router } from 'express';
import { createOrganization, listOrganizations } from '../controllers/organizationController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.post('/', createOrganization);
router.get('/', listOrganizations);

export default router;
