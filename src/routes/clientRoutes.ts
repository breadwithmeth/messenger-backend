import express from 'express';
import {
  getClients,
  getClientById,
  createClient,
  updateClient,
  deleteClient,
  getClientsStats,
  importClients,
  exportClients,
  updateClientFinancials
} from '../controllers/clientController';
import * as tagController from '../controllers/clientTagController';
import { authMiddleware } from '../middlewares/authMiddleware';

const router = express.Router();

// Все роуты требуют аутентификации
router.use(authMiddleware);

/**
 * @route   GET /api/clients
 * @desc    Получить список клиентов с фильтрацией и пагинацией
 * @query   page, limit, status, segment, clientType, search, assignedUserId, sortBy, sortOrder
 * @access  Private
 */
router.get('/', getClients);

/**
 * @route   GET /api/clients/stats
 * @desc    Получить статистику по клиентам
 * @access  Private
 */
router.get('/stats', getClientsStats);

/**
 * @route   GET /api/clients/export
 * @desc    Экспортировать клиентов в CSV/JSON
 * @query   format (json | csv)
 * @access  Private
 */
router.get('/export', exportClients);

/**
 * 🏷️ ТЕГИ - должны быть ДО параметризованных маршрутов
 */

/**
 * @route   GET /api/clients/tags
 * @desc    Получить все теги организации
 * @access  Private
 */
router.get('/tags', tagController.getTags);

/**
 * @route   GET /api/clients/tags/:id
 * @desc    Получить тег по ID
 * @access  Private
 */
router.get('/tags/:id', tagController.getTagById);

/**
 * @route   POST /api/clients/tags
 * @desc    Создать новый тег
 * @body    { name: string, color?: string }
 * @access  Private
 */
router.post('/tags', tagController.createTag);

/**
 * @route   PUT /api/clients/tags/:id
 * @desc    Обновить тег
 * @body    { name?: string, color?: string }
 * @access  Private
 */
router.put('/tags/:id', tagController.updateTag);

/**
 * @route   DELETE /api/clients/tags/:id
 * @desc    Удалить тег
 * @access  Private
 */
router.delete('/tags/:id', tagController.deleteTag);

/**
 * @route   GET /api/clients/:id
 * @desc    Получить клиента по ID
 * @access  Private
 */
router.get('/:id', getClientById);

/**
 * @route   POST /api/clients
 * @desc    Создать нового клиента
 * @access  Private
 */
router.post('/', createClient);

/**
 * @route   POST /api/clients/import
 * @desc    Импортировать клиентов из массива
 * @body    { clients: [...] }
 * @access  Private
 */
router.post('/import', importClients);

/**
 * @route   POST /api/clients/:clientId/tags/:tagId
 * @desc    Добавить тег клиенту
 * @access  Private
 */
router.post('/:clientId/tags/:tagId', tagController.addTagToClient);

/**
 * @route   PUT /api/clients/:id
 * @desc    Обновить клиента
 * @access  Private
 */
router.put('/:id', updateClient);

/**
 * @route   PUT /api/clients/:id/financials
 * @desc    Обновить финансовую статистику клиента (добавить покупку)
 * @body    { purchaseAmount: number }
 * @access  Private
 */
router.put('/:id/financials', updateClientFinancials);

/**
 * @route   DELETE /api/clients/:id
 * @desc    Удалить клиента
 * @access  Private
 */
router.delete('/:id', deleteClient);

/**
 * @route   DELETE /api/clients/:clientId/tags/:tagId
 * @desc    Удалить тег у клиента
 * @access  Private
 */
router.delete('/:clientId/tags/:tagId', tagController.removeTagFromClient);

export default router;
