"use strict";
// src/controllers/unreadController.ts
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
exports.getChatsWithUnread = exports.getUnreadCounts = exports.markChatAsRead = exports.markMessagesAsRead = void 0;
const authStorage_1 = require("../config/authStorage");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
/**
 * Отметить сообщения как прочитанные
 */
const markMessagesAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { chatId } = req.params;
    const { messageIds } = req.body; // Массив ID сообщений для отметки как прочитанные
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    try {
        // Проверяем, что чат принадлежит организации
        const chat = yield authStorage_1.prisma.chat.findUnique({
            where: {
                id: parseInt(chatId),
                organizationId: organizationId,
            },
        });
        if (!chat) {
            return res.status(404).json({ error: 'Чат не найден' });
        }
        let whereCondition = {
            chatId: parseInt(chatId),
            organizationId: organizationId,
            isReadByOperator: false,
            fromMe: false, // Только входящие сообщения могут быть отмечены как прочитанные
        };
        // Если указаны конкретные сообщения, отмечаем только их
        if (messageIds && Array.isArray(messageIds) && messageIds.length > 0) {
            whereCondition.id = { in: messageIds.map(id => parseInt(id)) };
        }
        // Обновляем сообщения
        const updateResult = yield authStorage_1.prisma.message.updateMany({
            where: whereCondition,
            data: {
                isReadByOperator: true,
                readAt: new Date(),
            },
        });
        // Пересчитываем количество непрочитанных сообщений в чате
        const unreadCount = yield authStorage_1.prisma.message.count({
            where: {
                chatId: parseInt(chatId),
                isReadByOperator: false,
                fromMe: false,
            },
        });
        // Обновляем счетчик в чате
        yield authStorage_1.prisma.chat.update({
            where: { id: parseInt(chatId) },
            data: { unreadCount },
        });
        logger.info(`[markMessagesAsRead] Отмечено как прочитанные ${updateResult.count} сообщений в чате ${chatId}`);
        res.json({
            success: true,
            markedCount: updateResult.count,
            unreadCount,
            message: `Отмечено как прочитанные ${updateResult.count} сообщений`,
        });
    }
    catch (error) {
        logger.error(`[markMessagesAsRead] Ошибка отметки сообщений как прочитанные:`, error);
        res.status(500).json({ error: 'Ошибка отметки сообщений', details: error.message });
    }
});
exports.markMessagesAsRead = markMessagesAsRead;
/**
 * Отметить весь чат как прочитанный
 */
const markChatAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { chatId } = req.params;
    const organizationId = res.locals.organizationId;
    try {
        const chat = yield authStorage_1.prisma.chat.findUnique({
            where: {
                id: parseInt(chatId),
                organizationId: organizationId,
            },
        });
        if (!chat) {
            return res.status(404).json({ error: 'Чат не найден' });
        }
        // Отмечаем все непрочитанные входящие сообщения как прочитанные
        const updateResult = yield authStorage_1.prisma.message.updateMany({
            where: {
                chatId: parseInt(chatId),
                isReadByOperator: false,
                fromMe: false,
            },
            data: {
                isReadByOperator: true,
                readAt: new Date(),
            },
        });
        // Обнуляем счетчик непрочитанных в чате
        yield authStorage_1.prisma.chat.update({
            where: { id: parseInt(chatId) },
            data: { unreadCount: 0 },
        });
        logger.info(`[markChatAsRead] Весь чат ${chatId} отмечен как прочитанный (${updateResult.count} сообщений)`);
        res.json({
            success: true,
            markedCount: updateResult.count,
            message: `Чат отмечен как прочитанный`,
        });
    }
    catch (error) {
        logger.error(`[markChatAsRead] Ошибка отметки чата как прочитанный:`, error);
        res.status(500).json({ error: 'Ошибка отметки чата', details: error.message });
    }
});
exports.markChatAsRead = markChatAsRead;
/**
 * Получить количество непрочитанных сообщений
 */
const getUnreadCounts = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    try {
        // Общее количество непрочитанных сообщений для организации
        const totalUnreadMessages = yield authStorage_1.prisma.message.count({
            where: {
                organizationId: organizationId,
                isReadByOperator: false,
                fromMe: false,
            },
        });
        // Количество чатов с непрочитанными сообщениями
        const chatsWithUnread = yield authStorage_1.prisma.chat.count({
            where: {
                organizationId: organizationId,
                unreadCount: { gt: 0 },
            },
        });
        // Непрочитанные сообщения в назначенных текущему пользователю чатах
        const assignedUnreadMessages = yield authStorage_1.prisma.message.count({
            where: {
                organizationId: organizationId,
                isReadByOperator: false,
                fromMe: false,
                chat: {
                    assignedUserId: userId,
                },
            },
        });
        // Количество назначенных чатов с непрочитанными
        const assignedChatsWithUnread = yield authStorage_1.prisma.chat.count({
            where: {
                organizationId: organizationId,
                assignedUserId: userId,
                unreadCount: { gt: 0 },
            },
        });
        res.json({
            total: {
                unreadMessages: totalUnreadMessages,
                chatsWithUnread: chatsWithUnread,
            },
            assigned: {
                unreadMessages: assignedUnreadMessages,
                chatsWithUnread: assignedChatsWithUnread,
            },
        });
    }
    catch (error) {
        logger.error(`[getUnreadCounts] Ошибка получения статистики непрочитанных:`, error);
        res.status(500).json({ error: 'Ошибка получения статистики', details: error.message });
    }
});
exports.getUnreadCounts = getUnreadCounts;
/**
 * Получить чаты с непрочитанными сообщениями
 */
const getChatsWithUnread = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId;
    const { assignedOnly } = req.query;
    const userId = res.locals.userId;
    try {
        let whereCondition = {
            organizationId: organizationId,
            unreadCount: { gt: 0 },
        };
        // Если запрашиваются только назначенные чаты
        if (assignedOnly === 'true') {
            whereCondition.assignedUserId = userId;
        }
        const chats = yield authStorage_1.prisma.chat.findMany({
            where: whereCondition,
            include: {
                assignedUser: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
                organizationPhone: {
                    select: {
                        id: true,
                        phoneJid: true,
                        displayName: true,
                    },
                },
                messages: {
                    take: 1,
                    orderBy: {
                        timestamp: 'desc',
                    },
                    select: {
                        id: true,
                        content: true,
                        timestamp: true,
                        fromMe: true,
                        type: true,
                        isReadByOperator: true,
                    },
                },
            },
            orderBy: [
                { unreadCount: 'desc' },
                { lastMessageAt: 'desc' },
            ],
        });
        const chatsWithLastMessage = chats.map(chat => (Object.assign(Object.assign({}, chat), { lastMessage: chat.messages.length > 0 ? chat.messages[0] : null, messages: undefined })));
        res.json({
            chats: chatsWithLastMessage,
            total: chats.length,
        });
    }
    catch (error) {
        logger.error(`[getChatsWithUnread] Ошибка получения чатов с непрочитанными:`, error);
        res.status(500).json({ error: 'Ошибка получения чатов', details: error.message });
    }
});
exports.getChatsWithUnread = getChatsWithUnread;
//# sourceMappingURL=unreadController.js.map