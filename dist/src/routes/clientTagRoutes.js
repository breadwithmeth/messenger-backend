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
const tagController = __importStar(require("../controllers/clientTagController"));
const authMiddleware_1 = require("../middlewares/authMiddleware");
const router = express_1.default.Router();
// Все маршруты требуют аутентификации
router.use(authMiddleware_1.authMiddleware);
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
exports.default = router;
//# sourceMappingURL=clientTagRoutes.js.map