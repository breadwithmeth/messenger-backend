// src/routes/authRoutes.ts
import { Router } from 'express';
import { loginHandler } from '../controllers/authController.js';

const router = Router();

router.post('/login', loginHandler);

export default router;
