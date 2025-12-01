"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const clientController_1 = require("../controllers/clientController");
const tagController = __importStar(require("../controllers/clientTagController"));
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Все роуты требуют аутентификации
router.use(authMiddleware_1.authMiddleware);
/**
 * @route   GET /api/clients
 * @desc    Получить список клиентов с фильтрацией и пагинацией
 * @query   page, limit, status, segment, clientType, search, assignedUserId, sortBy, sortOrder
 * @access  Private
 */
router.get('/', clientController_1.getClients);
/**
 * @route   GET /api/clients/stats
 * @desc    Получить статистику по клиентам
 * @access  Private
 */
router.get('/stats', clientController_1.getClientsStats);
/**
 * @route   GET /api/clients/export
 * @desc    Экспортировать клиентов в CSV/JSON
 * @query   format (json | csv)
 * @access  Private
 */
router.get('/export', clientController_1.exportClients);
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
router.get('/:id', clientController_1.getClientById);
/**
 * @route   POST /api/clients
 * @desc    Создать нового клиента
 * @access  Private
 */
router.post('/', clientController_1.createClient);
/**
 * @route   POST /api/clients/import
 * @desc    Импортировать клиентов из массива
 * @body    { clients: [...] }
 * @access  Private
 */
router.post('/import', clientController_1.importClients);
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
router.put('/:id', clientController_1.updateClient);
/**
 * @route   PUT /api/clients/:id/financials
 * @desc    Обновить финансовую статистику клиента (добавить покупку)
 * @body    { purchaseAmount: number }
 * @access  Private
 */
router.put('/:id/financials', clientController_1.updateClientFinancials);
/**
 * @route   DELETE /api/clients/:id
 * @desc    Удалить клиента
 * @access  Private
 */
router.delete('/:id', clientController_1.deleteClient);
/**
 * @route   DELETE /api/clients/:clientId/tags/:tagId
 * @desc    Удалить тег у клиента
 * @access  Private
 */
router.delete('/:clientId/tags/:tagId', tagController.removeTagFromClient);
exports.default = router;
//# sourceMappingURL=clientRoutes.js.map