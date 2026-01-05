"use strict";
// src/controllers/chatController.ts
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
exports.getChatMessages = void 0;
exports.listChats = listChats;
const pino_1 = __importDefault(require("pino"));
const authStorage_1 = require("../config/authStorage"); // Используем единый клиент Prisma
const logger = (0, pino_1.default)({ level: 'info' });
// export async function createChat(req: Request, res: Response) {
//   try {
//     const { organizationId, clientId, operatorId } = req.body;
//     if (!organizationId || !clientId || !operatorId) {
//       return res.status(400).json({ error: 'Не указаны обязательные поля' });
//     }
//     const chat = await chatService.createChat(organizationId, clientId, operatorId);
//     res.json(chat);
//   } catch (err) {
//     res.status(500).json({ error: 'Ошибка создания чата' });
//   }
// }
function listChats(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const organizationId = res.locals.organizationId;
            const userId = res.locals.userId; // ID текущего пользователя
            const { status, assigned, assignedToMe, // Новый параметр для фильтрации по текущему пользователю
            priority, channel, includeProfile, search, // Новый параметр для поиска по тексту сообщения или номеру телефона
            searchType, // 'message', 'phone', или 'all' (по умолчанию)
            limit = '50', offset = '0', sortBy = 'lastMessageAt', // Поле для сортировки
            sortOrder = 'desc' // Направление сортировки (asc/desc)
             } = req.query;
            if (!organizationId) {
                logger.warn('[listChats] organizationId не определен в res.locals.');
                return res.status(400).json({ error: 'organizationId обязателен' });
            }
            // Парсинг пагинации
            const take = Math.min(parseInt(limit, 10) || 50, 100); // Максимум 100 чатов за раз
            const skip = parseInt(offset, 10) || 0;
            // Построение условий фильтрации
            let whereCondition = {
                organizationId: organizationId,
            };
            // Фильтрация по поиску (текст сообщения или номер телефона)
            if (search && typeof search === 'string' && search.trim().length > 0) {
                const searchQuery = search.trim();
                const searchLower = searchQuery.toLowerCase();
                const searchType_ = searchType === 'message' ? 'message' : searchType === 'phone' ? 'phone' : 'all';
                logger.info(`[listChats] Поиск по: ${searchType_}, запрос: "${searchQuery}"`);
                if (searchType_ === 'phone' || searchType_ === 'all') {
                    // Поиск по номеру телефона (remoteJid содержит номер)
                    // Номера в формате: 79001234567@s.whatsapp.net или 123456789 (для Telegram)
                    whereCondition.OR = whereCondition.OR || [];
                    whereCondition.OR.push({
                        remoteJid: {
                            contains: searchQuery.replace(/\D/g, ''), // Ищем только цифры
                            mode: 'insensitive',
                        },
                    });
                    // Также ищем в имени чата
                    whereCondition.OR.push({
                        name: {
                            contains: searchQuery,
                            mode: 'insensitive',
                        },
                    });
                    // Для Telegram - поиск по username
                    whereCondition.OR.push({
                        telegramUsername: {
                            contains: searchQuery,
                            mode: 'insensitive',
                        },
                    });
                }
                if (searchType_ === 'message' || searchType_ === 'all') {
                    // Поиск по тексту сообщений - используем messages relation
                    const matchingChats = yield authStorage_1.prisma.chat.findMany({
                        where: {
                            organizationId: organizationId,
                            messages: {
                                some: {
                                    content: {
                                        contains: searchQuery,
                                        mode: 'insensitive',
                                    },
                                },
                            },
                        },
                        select: { id: true },
                    });
                    const matchingChatIds = matchingChats.map(chat => chat.id);
                    if (matchingChatIds.length > 0) {
                        whereCondition.OR = whereCondition.OR || [];
                        whereCondition.OR.push({
                            id: { in: matchingChatIds },
                        });
                    }
                }
                // Если результат пуст для OR условия, нужно обработать это правильно
                if (whereCondition.OR && whereCondition.OR.length === 0) {
                    delete whereCondition.OR;
                }
            }
            // Фильтрация по каналу (whatsapp или telegram)
            if (channel && typeof channel === 'string' && (channel === 'whatsapp' || channel === 'telegram')) {
                whereCondition.channel = channel;
            }
            // Фильтрация по статусу
            if (status && typeof status === 'string') {
                whereCondition.status = status;
            }
            // Фильтрация по приоритету
            if (priority && typeof priority === 'string') {
                whereCondition.priority = priority;
            }
            // Фильтрация по назначению на текущего пользователя
            if (assignedToMe === 'true') {
                if (!userId) {
                    return res.status(400).json({ error: 'userId не определен. Требуется авторизация.' });
                }
                whereCondition.assignedUserId = userId;
            }
            else if (assigned === 'true') {
                // Все назначенные чаты (любому оператору)
                whereCondition.assignedUserId = { not: null };
            }
            else if (assigned === 'false') {
                // Неназначенные чаты
                whereCondition.assignedUserId = null;
            }
            // Построение сортировки
            const allowedSortFields = [
                'lastMessageAt',
                'createdAt',
                'priority',
                'unreadCount',
                'ticketNumber',
                'status',
                'name'
            ];
            const sortField = typeof sortBy === 'string' && allowedSortFields.includes(sortBy)
                ? sortBy
                : 'lastMessageAt';
            const sortDirection = sortOrder === 'asc' ? 'asc' : 'desc';
            // Если не указана сортировка, используем умную сортировку по умолчанию
            let orderBy;
            if (req.query.sortBy === undefined) {
                // Умная сортировка по умолчанию (многокритериальная)
                orderBy = [
                    { priority: 'desc' }, // 1. Сначала приоритетные
                    { unreadCount: 'desc' }, // 2. Затем с непрочитанными
                    { lastMessageAt: 'desc' }, // 3. Потом по времени
                ];
            }
            else {
                // Пользовательская сортировка
                orderBy = { [sortField]: sortDirection };
            }
            // Получаем общее количество (для пагинации)
            const totalCount = yield authStorage_1.prisma.chat.count({ where: whereCondition });
            // Получаем чаты с пагинацией и оптимизированными select
            const chats = yield authStorage_1.prisma.chat.findMany({
                where: whereCondition,
                take,
                skip,
                select: {
                    id: true,
                    name: true,
                    channel: true, // whatsapp | telegram
                    remoteJid: true,
                    receivingPhoneJid: true,
                    isGroup: true,
                    status: true,
                    priority: true,
                    unreadCount: true,
                    lastMessageAt: true,
                    ticketNumber: true,
                    createdAt: true,
                    // WhatsApp specific
                    organizationPhone: {
                        select: {
                            id: true,
                            phoneJid: true,
                            displayName: true,
                            connectionType: true, // baileys | waba
                        },
                    },
                    // Telegram specific
                    telegramBot: {
                        select: {
                            id: true,
                            botUsername: true,
                            botName: true,
                        },
                    },
                    telegramChatId: true,
                    telegramUsername: true,
                    telegramFirstName: true,
                    telegramLastName: true,
                    // Common
                    assignedUser: {
                        select: {
                            id: true,
                            name: true,
                            email: true,
                        },
                    },
                    // Информация о клиентах
                    organizationClients: {
                        select: {
                            id: true,
                            name: true,
                            clientType: true,
                            segment: true,
                            status: true,
                            whatsappJid: true,
                            telegramUserId: true,
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
                            senderJid: true,
                            timestamp: true,
                            fromMe: true,
                            type: true,
                            isReadByOperator: true,
                            mediaUrl: true,
                        },
                    },
                },
                orderBy: orderBy,
            });
            // Преобразуем результат (без дополнительных запросов к Baileys)
            const wantProfile = String(includeProfile).toLowerCase() === 'true';
            const chatsWithLastMessage = chats.map((chat) => {
                const base = Object.assign(Object.assign({}, chat), { lastMessage: chat.messages.length > 0 ? chat.messages[0] : null });
                delete base.messages;
                if (wantProfile) {
                    // Используем уже сохранённые данные из Chat.name
                    base.displayName = chat.name || null;
                    // Для фото профиля можно добавить отдельный эндпоинт
                    base.profilePhotoUrl = null;
                }
                return base;
            });
            res.json({
                chats: chatsWithLastMessage,
                pagination: {
                    total: totalCount,
                    limit: take,
                    offset: skip,
                    hasMore: skip + take < totalCount,
                },
            });
        }
        catch (err) {
            logger.error(`[listChats] Ошибка получения чатов для организации ${res.locals.organizationId || 'неизвестно'}:`, err);
            res.status(500).json({ error: 'Ошибка получения чатов', details: err.message });
        }
    });
}
const getChatMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const organizationId = res.locals.organizationId;
    const chatId = parseInt(req.params.chatId, 10);
    const { limit = '100', offset = '0', before } = req.query;
    if (!organizationId) {
        logger.warn('[getChatMessages] Несанкционированный доступ: organizationId не определен в res.locals.');
        return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
    }
    if (isNaN(chatId)) {
        logger.warn(`[getChatMessages] Некорректный chatId: "${req.params.chatId}". Ожидалось число.`);
        return res.status(400).json({ error: 'Некорректный chatId. Ожидалось число.' });
    }
    try {
        // Парсинг пагинации
        const take = Math.min(parseInt(limit, 10) || 100, 200); // Максимум 200 сообщений
        const skip = parseInt(offset, 10) || 0;
        // Проверяем существование чата (оптимизировано - только id)
        const chat = yield authStorage_1.prisma.chat.findFirst({
            where: {
                id: chatId,
                organizationId: organizationId,
            },
            select: { id: true },
        });
        if (!chat) {
            logger.warn(`[getChatMessages] Чат с ID ${chatId} не найден или не принадлежит организации ${organizationId}.`);
            return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
        }
        // Построение условий запроса
        const whereCondition = {
            chatId: chatId,
            organizationId: organizationId,
        };
        // Фильтр "before" для подгрузки старых сообщений (курсорная пагинация)
        if (before && typeof before === 'string') {
            const beforeDate = new Date(before);
            if (!isNaN(beforeDate.getTime())) {
                whereCondition.timestamp = { lt: beforeDate };
            }
        }
        // Получаем общее количество сообщений в чате
        const totalCount = yield authStorage_1.prisma.message.count({
            where: { chatId, organizationId },
        });
        // Получаем сообщения с оптимизированным select
        const messages = yield authStorage_1.prisma.message.findMany({
            where: whereCondition,
            take,
            skip,
            select: {
                id: true,
                whatsappMessageId: true,
                content: true,
                senderJid: true,
                receivingPhoneJid: true,
                fromMe: true,
                type: true,
                mediaUrl: true,
                filename: true,
                mimeType: true,
                size: true,
                timestamp: true,
                status: true,
                isReadByOperator: true,
                quotedMessageId: true,
                senderUser: {
                    select: {
                        id: true,
                        name: true,
                        email: true,
                    },
                },
            },
            orderBy: {
                timestamp: 'desc', // Последние сообщения сначала
            },
        });
        // Переворачиваем массив для отображения в хронологическом порядке (старые → новые)
        const messagesInChronologicalOrder = messages.reverse();
        res.status(200).json({
            messages: messagesInChronologicalOrder,
            pagination: {
                total: totalCount,
                limit: take,
                offset: skip,
                hasMore: skip + take < totalCount,
                oldestTimestamp: messagesInChronologicalOrder.length > 0 ? messagesInChronologicalOrder[0].timestamp : null,
                newestTimestamp: messagesInChronologicalOrder.length > 0 ? messagesInChronologicalOrder[messagesInChronologicalOrder.length - 1].timestamp : null,
            },
        });
    }
    catch (error) {
        logger.error(`[getChatMessages] Ошибка при получении сообщений для чата ${chatId} организации ${organizationId}:`, error);
        res.status(500).json({
            error: 'Не удалось получить сообщения чата.',
            details: error.message,
        });
    }
});
exports.getChatMessages = getChatMessages;
//# sourceMappingURL=chatController.js.map