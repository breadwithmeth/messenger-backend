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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getTags = getTags;
exports.getTagById = getTagById;
exports.createTag = createTag;
exports.updateTag = updateTag;
exports.deleteTag = deleteTag;
exports.addTagToClient = addTagToClient;
exports.removeTagFromClient = removeTagFromClient;
const pino_1 = __importDefault(require("pino"));
const tagService = __importStar(require("../services/clientTagService"));
const logger = (0, pino_1.default)();
/**
 * 🏷️ GET /api/clients/tags - Получить все теги организации
 */
function getTags(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
            if (!organizationId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            const tags = yield tagService.getOrganizationTags(organizationId);
            res.json(tags);
        }
        catch (error) {
            logger.error({ error: error.message }, '❌ Ошибка при получении тегов');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
/**
 * 🏷️ GET /api/clients/tags/:id - Получить тег по ID
 */
function getTagById(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
            const tagId = parseInt(req.params.id);
            if (!organizationId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (isNaN(tagId)) {
                return res.status(400).json({ error: 'Invalid tag ID' });
            }
            const tag = yield tagService.getTagById(tagId, organizationId);
            if (!tag) {
                return res.status(404).json({ error: 'Tag not found' });
            }
            res.json(tag);
        }
        catch (error) {
            logger.error({ error: error.message }, '❌ Ошибка при получении тега');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
/**
 * ➕ POST /api/clients/tags - Создать новый тег
 */
function createTag(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
            const { name, color } = req.body;
            if (!organizationId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                return res.status(400).json({ error: 'Name is required' });
            }
            const tag = yield tagService.createTag({
                name: name.trim(),
                color,
                organizationId
            });
            res.status(201).json(tag);
        }
        catch (error) {
            if (error.message === 'Тег с таким именем уже существует') {
                return res.status(409).json({ error: error.message });
            }
            logger.error({ error: error.message }, '❌ Ошибка при создании тега');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
/**
 * 📝 PUT /api/clients/tags/:id - Обновить тег
 */
function updateTag(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
            const tagId = parseInt(req.params.id);
            const { name, color } = req.body;
            if (!organizationId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (isNaN(tagId)) {
                return res.status(400).json({ error: 'Invalid tag ID' });
            }
            const data = {};
            if (name !== undefined) {
                if (typeof name !== 'string' || name.trim().length === 0) {
                    return res.status(400).json({ error: 'Name must be a non-empty string' });
                }
                data.name = name.trim();
            }
            if (color !== undefined) {
                data.color = color;
            }
            if (Object.keys(data).length === 0) {
                return res.status(400).json({ error: 'No fields to update' });
            }
            const tag = yield tagService.updateTag(tagId, organizationId, data);
            res.json(tag);
        }
        catch (error) {
            if (error.message === 'Тег не найден') {
                return res.status(404).json({ error: error.message });
            }
            if (error.message === 'Тег с таким именем уже существует') {
                return res.status(409).json({ error: error.message });
            }
            logger.error({ error: error.message }, '❌ Ошибка при обновлении тега');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
/**
 * ❌ DELETE /api/clients/tags/:id - Удалить тег
 */
function deleteTag(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
            const tagId = parseInt(req.params.id);
            if (!organizationId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (isNaN(tagId)) {
                return res.status(400).json({ error: 'Invalid tag ID' });
            }
            yield tagService.deleteTag(tagId, organizationId);
            res.status(204).send();
        }
        catch (error) {
            if (error.message === 'Тег не найден') {
                return res.status(404).json({ error: error.message });
            }
            logger.error({ error: error.message }, '❌ Ошибка при удалении тега');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
/**
 * 🔗 POST /api/clients/:clientId/tags/:tagId - Добавить тег клиенту
 */
function addTagToClient(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
            const clientId = parseInt(req.params.clientId);
            const tagId = parseInt(req.params.tagId);
            if (!organizationId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (isNaN(clientId) || isNaN(tagId)) {
                return res.status(400).json({ error: 'Invalid client or tag ID' });
            }
            yield tagService.addTagToClient(clientId, tagId, organizationId);
            res.status(204).send();
        }
        catch (error) {
            if (error.message === 'Клиент не найден' || error.message === 'Тег не найден') {
                return res.status(404).json({ error: error.message });
            }
            logger.error({ error: error.message }, '❌ Ошибка при добавлении тега клиенту');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
/**
 * 🔓 DELETE /api/clients/:clientId/tags/:tagId - Удалить тег у клиента
 */
function removeTagFromClient(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        try {
            const organizationId = (_a = req.user) === null || _a === void 0 ? void 0 : _a.organizationId;
            const clientId = parseInt(req.params.clientId);
            const tagId = parseInt(req.params.tagId);
            if (!organizationId) {
                return res.status(401).json({ error: 'Unauthorized' });
            }
            if (isNaN(clientId) || isNaN(tagId)) {
                return res.status(400).json({ error: 'Invalid client or tag ID' });
            }
            yield tagService.removeTagFromClient(clientId, tagId, organizationId);
            res.status(204).send();
        }
        catch (error) {
            if (error.message === 'Клиент не найден') {
                return res.status(404).json({ error: error.message });
            }
            logger.error({ error: error.message }, '❌ Ошибка при удалении тега у клиента');
            res.status(500).json({ error: 'Internal server error' });
        }
    });
}
//# sourceMappingURL=clientTagController.js.map