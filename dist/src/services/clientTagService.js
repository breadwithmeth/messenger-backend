"use strict";
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
exports.getOrganizationTags = getOrganizationTags;
exports.getTagById = getTagById;
exports.createTag = createTag;
exports.updateTag = updateTag;
exports.deleteTag = deleteTag;
exports.addTagToClient = addTagToClient;
exports.removeTagFromClient = removeTagFromClient;
const client_1 = require("@prisma/client");
const pino_1 = __importDefault(require("pino"));
const prisma = new client_1.PrismaClient();
const logger = (0, pino_1.default)();
/**
 * 🏷️ Получить все теги организации
 */
function getOrganizationTags(organizationId) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info({ organizationId }, '🏷️ Получение тегов организации');
        const tags = yield prisma.clientTag.findMany({
            where: { organizationId },
            include: {
                _count: {
                    select: { clients: true }
                }
            },
            orderBy: { name: 'asc' }
        });
        logger.info({ count: tags.length }, '✅ Теги получены');
        return tags;
    });
}
/**
 * 🏷️ Получить тег по ID
 */
function getTagById(tagId, organizationId) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info({ tagId, organizationId }, '🏷️ Получение тега по ID');
        const tag = yield prisma.clientTag.findFirst({
            where: {
                id: tagId,
                organizationId
            },
            include: {
                _count: {
                    select: { clients: true }
                }
            }
        });
        if (tag) {
            logger.info({ tagId }, '✅ Тег найден');
        }
        else {
            logger.warn({ tagId }, '⚠️ Тег не найден');
        }
        return tag;
    });
}
/**
 * ➕ Создать новый тег
 */
function createTag(data) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info({ name: data.name, organizationId: data.organizationId }, '➕ Создание нового тега');
        // Проверяем, не существует ли уже тег с таким именем
        const existing = yield prisma.clientTag.findFirst({
            where: {
                name: data.name,
                organizationId: data.organizationId
            }
        });
        if (existing) {
            logger.warn({ name: data.name }, '⚠️ Тег с таким именем уже существует');
            throw new Error('Тег с таким именем уже существует');
        }
        const tag = yield prisma.clientTag.create({
            data: {
                name: data.name,
                color: data.color,
                organizationId: data.organizationId
            }
        });
        logger.info({ tagId: tag.id, name: tag.name }, '✅ Тег создан');
        return tag;
    });
}
/**
 * 📝 Обновить тег
 */
function updateTag(tagId, organizationId, data) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info({ tagId, organizationId }, '📝 Обновление тега');
        // Проверяем существование тега
        const existing = yield getTagById(tagId, organizationId);
        if (!existing) {
            throw new Error('Тег не найден');
        }
        // Если меняется имя, проверяем уникальность
        if (data.name) {
            const duplicate = yield prisma.clientTag.findFirst({
                where: {
                    name: data.name,
                    organizationId,
                    id: { not: tagId }
                }
            });
            if (duplicate) {
                logger.warn({ name: data.name }, '⚠️ Тег с таким именем уже существует');
                throw new Error('Тег с таким именем уже существует');
            }
        }
        const tag = yield prisma.clientTag.update({
            where: { id: tagId },
            data
        });
        logger.info({ tagId }, '✅ Тег обновлен');
        return tag;
    });
}
/**
 * ❌ Удалить тег
 */
function deleteTag(tagId, organizationId) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info({ tagId, organizationId }, '❌ Удаление тега');
        // Проверяем существование тега
        const existing = yield getTagById(tagId, organizationId);
        if (!existing) {
            throw new Error('Тег не найден');
        }
        yield prisma.clientTag.delete({
            where: { id: tagId }
        });
        logger.info({ tagId }, '✅ Тег удален');
    });
}
/**
 * 🔗 Добавить тег клиенту
 */
function addTagToClient(clientId, tagId, organizationId) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info({ clientId, tagId, organizationId }, '🔗 Добавление тега клиенту');
        // Проверяем, что клиент принадлежит организации
        const client = yield prisma.organizationClient.findFirst({
            where: {
                id: clientId,
                organizationId
            }
        });
        if (!client) {
            logger.warn({ clientId }, '⚠️ Клиент не найден');
            throw new Error('Клиент не найден');
        }
        // Проверяем, что тег принадлежит организации
        const tag = yield getTagById(tagId, organizationId);
        if (!tag) {
            throw new Error('Тег не найден');
        }
        // Добавляем связь
        yield prisma.organizationClient.update({
            where: { id: clientId },
            data: {
                tags: {
                    connect: { id: tagId }
                }
            }
        });
        logger.info({ clientId, tagId }, '✅ Тег добавлен клиенту');
    });
}
/**
 * 🔓 Удалить тег у клиента
 */
function removeTagFromClient(clientId, tagId, organizationId) {
    return __awaiter(this, void 0, void 0, function* () {
        logger.info({ clientId, tagId, organizationId }, '🔓 Удаление тега у клиента');
        // Проверяем, что клиент принадлежит организации
        const client = yield prisma.organizationClient.findFirst({
            where: {
                id: clientId,
                organizationId
            }
        });
        if (!client) {
            logger.warn({ clientId }, '⚠️ Клиент не найден');
            throw new Error('Клиент не найден');
        }
        // Удаляем связь
        yield prisma.organizationClient.update({
            where: { id: clientId },
            data: {
                tags: {
                    disconnect: { id: tagId }
                }
            }
        });
        logger.info({ clientId, tagId }, '✅ Тег удален у клиента');
    });
}
//# sourceMappingURL=clientTagService.js.map