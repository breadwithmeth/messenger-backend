"use strict";
// src/controllers/messageReadController.ts
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
exports.markTicketMessagesAsRead = exports.getMessageStats = exports.getUnreadCount = exports.markMessagesAsRead = void 0;
const authStorage_1 = require("../config/authStorage");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
/**
 * Отмечает сообщения в чате как прочитанные
 */
const markMessagesAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const chatId = parseInt(req.params.chatId, 10);
    if (!organizationId || !userId) {
        logger.warn('[markMessagesAsRead] organizationId или userId не определены в res.locals.');
        return res.status(401).json({ error: 'Несанкционированный доступ' });
    }
    if (isNaN(chatId)) {
        logger.warn(`[markMessagesAsRead] Некорректный chatId: "${req.params.chatId}"`);
        return res.status(400).json({ error: 'Некорректный chatId' });
    }
    try {
        // Проверяем, что чат принадлежит организации
        const chat = yield authStorage_1.prisma.chat.findFirst({
            where: {
                id: chatId,
                organizationId: organizationId,
            },
        });
        if (!chat) {
            logger.warn(`[markMessagesAsRead] Чат с ID ${chatId} не найден для организации ${organizationId}`);
            return res.status(404).json({ error: 'Чат не найден' });
        }
        // Получаем количество непрочитанных сообщений перед обновлением
        const unreadCount = yield authStorage_1.prisma.message.count({
            where: {
                chatId: chatId,
                organizationId: organizationId,
                isReadByOperator: false,
                fromMe: false, // Только входящие сообщения
            },
        });
        // Отмечаем все непрочитанные сообщения в чате как прочитанные
        const updateResult = yield authStorage_1.prisma.message.updateMany({
            where: {
                chatId: chatId,
                organizationId: organizationId,
                isReadByOperator: false,
                fromMe: false, // Только входящие сообщения
            },
            data: {
                isReadByOperator: true,
                readAt: new Date(),
            },
        });
        // Обнуляем счетчик непрочитанных сообщений в чате
        yield authStorage_1.prisma.chat.update({
            where: { id: chatId },
            data: { unreadCount: 0 },
        });
        logger.info(`✅ Отмечено как прочитанное ${updateResult.count} сообщений в чате ${chatId} пользователем ${userId}`);
        res.status(200).json({
            success: true,
            markedAsRead: updateResult.count,
            message: `Отмечено как прочитанное ${updateResult.count} сообщений`,
        });
    }
    catch (error) {
        logger.error(`❌ Ошибка при отметке сообщений как прочитанных в чате ${chatId}:`, error);
        res.status(500).json({
            error: 'Не удалось отметить сообщения как прочитанные',
            details: error.message,
        });
    }
});
exports.markMessagesAsRead = markMessagesAsRead;
/**
 * Получает количество непрочитанных сообщений для пользователя
 */
const getUnreadCount = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    if (!organizationId || !userId) {
        logger.warn('[getUnreadCount] organizationId или userId не определены в res.locals.');
        return res.status(401).json({ error: 'Несанкционированный доступ' });
    }
    try {
        // Получаем общий счетчик непрочитанных сообщений для назначенных пользователю чатов
        const totalUnreadCount = yield authStorage_1.prisma.message.count({
            where: {
                organizationId: organizationId,
                isReadByOperator: false,
                fromMe: false, // Только входящие сообщения
                chat: {
                    assignedUserId: userId,
                    status: {
                        in: ['open', 'pending'],
                    },
                },
            },
        });
        // Получаем количество непрочитанных сообщений по чатам
        const unreadByChat = yield authStorage_1.prisma.chat.findMany({
            where: {
                organizationId: organizationId,
                assignedUserId: userId,
                status: {
                    in: ['open', 'pending'],
                },
                unreadCount: {
                    gt: 0,
                },
            },
            select: {
                id: true,
                name: true,
                remoteJid: true,
                unreadCount: true,
                lastMessageAt: true,
            },
            orderBy: {
                lastMessageAt: 'desc',
            },
        });
        res.status(200).json({
            totalUnreadCount,
            unreadByChat,
        });
    }
    catch (error) {
        logger.error(`❌ Ошибка при получении счетчика непрочитанных сообщений для пользователя ${userId}:`, error);
        res.status(500).json({
            error: 'Не удалось получить счетчик непрочитанных сообщений',
            details: error.message,
        });
    }
});
exports.getUnreadCount = getUnreadCount;
/**
 * Получает статистику по сообщениям для организации
 */
const getMessageStats = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId;
    if (!organizationId) {
        logger.warn('[getMessageStats] organizationId не определен в res.locals.');
        return res.status(401).json({ error: 'Несанкционированный доступ' });
    }
    try {
        // Общая статистика по чатам
        const totalChats = yield authStorage_1.prisma.chat.count({
            where: { organizationId },
        });
        const openChats = yield authStorage_1.prisma.chat.count({
            where: {
                organizationId,
                status: 'open',
            },
        });
        const assignedChats = yield authStorage_1.prisma.chat.count({
            where: {
                organizationId,
                assignedUserId: {
                    not: null,
                },
                status: {
                    in: ['open', 'pending'],
                },
            },
        });
        const unassignedChats = yield authStorage_1.prisma.chat.count({
            where: {
                organizationId,
                assignedUserId: null,
                status: {
                    in: ['open', 'pending'],
                },
            },
        });
        // Статистика по сообщениям
        const totalMessages = yield authStorage_1.prisma.message.count({
            where: { organizationId },
        });
        const totalUnreadMessages = yield authStorage_1.prisma.message.count({
            where: {
                organizationId,
                isReadByOperator: false,
                fromMe: false,
            },
        });
        // Статистика по операторам
        const operatorStats = yield authStorage_1.prisma.user.findMany({
            where: {
                organizationId,
                role: 'operator',
            },
            select: {
                id: true,
                name: true,
                email: true,
                _count: {
                    select: {
                        assignedChats: {
                            where: {
                                status: {
                                    in: ['open', 'pending'],
                                },
                            },
                        },
                    },
                },
            },
        });
        res.status(200).json({
            chats: {
                total: totalChats,
                open: openChats,
                assigned: assignedChats,
                unassigned: unassignedChats,
            },
            messages: {
                total: totalMessages,
                unread: totalUnreadMessages,
            },
            operators: operatorStats,
        });
    }
    catch (error) {
        logger.error(`❌ Ошибка при получении статистики сообщений для организации ${organizationId}:`, error);
        res.status(500).json({
            error: 'Не удалось получить статистику сообщений',
            details: error.message,
        });
    }
});
exports.getMessageStats = getMessageStats;
/**
 * Отмечает все сообщения в тикете как прочитанные (по номеру тикета)
 */
const markTicketMessagesAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    const ticketNumber = parseInt(req.params.ticketNumber, 10);
    if (!organizationId || !userId) {
        logger.warn('[markTicketMessagesAsRead] organizationId или userId не определены в res.locals.');
        return res.status(401).json({ error: 'Несанкционированный доступ' });
    }
    if (isNaN(ticketNumber)) {
        logger.warn(`[markTicketMessagesAsRead] Некорректный ticketNumber: "${req.params.ticketNumber}"`);
        return res.status(400).json({ error: 'Некорректный номер тикета' });
    }
    try {
        // Находим чат по номеру тикета
        const chat = yield authStorage_1.prisma.chat.findFirst({
            where: {
                ticketNumber: ticketNumber,
                organizationId: organizationId,
            },
        });
        if (!chat) {
            logger.warn(`[markTicketMessagesAsRead] Тикет #${ticketNumber} не найден для организации ${organizationId}`);
            return res.status(404).json({ error: `Тикет #${ticketNumber} не найден` });
        }
        // Получаем количество непрочитанных сообщений перед обновлением
        const unreadCount = yield authStorage_1.prisma.message.count({
            where: {
                chatId: chat.id,
                organizationId: organizationId,
                isReadByOperator: false,
                fromMe: false, // Только входящие сообщения
            },
        });
        // Отмечаем все непрочитанные сообщения в тикете как прочитанные
        const updateResult = yield authStorage_1.prisma.message.updateMany({
            where: {
                chatId: chat.id,
                organizationId: organizationId,
                isReadByOperator: false,
                fromMe: false, // Только входящие сообщения
            },
            data: {
                isReadByOperator: true,
                readAt: new Date(),
            },
        });
        // Обнуляем счетчик непрочитанных сообщений в чате
        yield authStorage_1.prisma.chat.update({
            where: { id: chat.id },
            data: { unreadCount: 0 },
        });
        logger.info(`✅ Тикет #${ticketNumber}: отмечено как прочитанное ${updateResult.count} сообщений пользователем ${userId}`);
        res.status(200).json({
            success: true,
            ticketNumber: ticketNumber,
            markedAsRead: updateResult.count,
            message: `Тикет #${ticketNumber}: отмечено как прочитанное ${updateResult.count} сообщений`,
        });
    }
    catch (error) {
        logger.error(`❌ Ошибка при отметке сообщений тикета #${ticketNumber} как прочитанных:`, error);
        res.status(500).json({
            error: 'Не удалось отметить сообщения тикета как прочитанные',
            details: error.message,
        });
    }
});
exports.markTicketMessagesAsRead = markTicketMessagesAsRead;
//# sourceMappingURL=messageReadController.js.map