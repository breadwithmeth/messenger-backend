import express from 'express';
import * as tagController from '../controllers/clientTagController.js';
import { authMiddleware } from '../middlewares/authMiddleware.js';

const router = express.Router();

// Все маршруты требуют аутентификации
router.use(authMiddleware);

/**
 * 🏷️ Управление тегами
 */

// Получить все теги организации
router.get('/tags', tagController.getTags);

// Получить тег по ID
router.get('/tags/:id', tagController.getTagById);

// Создать новый тег
router.post('/tags', tagController.createTag);

// Обновить тег
router.put('/tags/:id', tagController.updateTag);

// Удалить тег
router.delete('/tags/:id', tagController.deleteTag);

/**
 * 🔗 Связь тегов с клиентами
 */

// Добавить тег клиенту
router.post('/:clientId/tags/:tagId', tagController.addTagToClient);

// Удалить тег у клиента
router.delete('/:clientId/tags/:tagId', tagController.removeTagFromClient);

export default router;
