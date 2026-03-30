// src/routes/organizationPhoneRoutes.ts
import { Router } from 'express';
import {
  createOrganizationPhone,
  listOrganizationPhones,
  connectOrganizationPhone,
  disconnectOrganizationPhone,
} from '../controllers/organizationPhoneController'; // Путь к вашему контроллеру

const router = Router();

// Маршруты для управления номерами организации
// POST /api/organization-phones - Добавить новый номер
router.post('/', createOrganizationPhone);

// GET /api/organization-phones - Получить список всех номеров
router.get('/all', listOrganizationPhones);

// POST /api/organization-phones/:organizationPhoneId/connect - Инициировать подключение номера (получение QR)
router.post('/:organizationPhoneId/connect', connectOrganizationPhone);

// DELETE /api/organization-phones/:organizationPhoneId/disconnect - Отключить номер (выйти из сессии)
router.delete('/:organizationPhoneId/disconnect', disconnectOrganizationPhone);

export default router;