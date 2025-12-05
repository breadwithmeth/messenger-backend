"use strict";
// src/services/telegramService.ts
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
exports.startTelegramBot = startTelegramBot;
exports.stopTelegramBot = stopTelegramBot;
exports.getTelegramBot = getTelegramBot;
exports.sendTelegramMessage = sendTelegramMessage;
exports.startAllTelegramBots = startAllTelegramBots;
exports.stopAllTelegramBots = stopAllTelegramBots;
const node_telegram_bot_api_1 = __importDefault(require("node-telegram-bot-api"));
const authStorage_1 = require("../config/authStorage");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
// Хранилище активных ботов
const activeBots = new Map();
/**
 * Запускает Telegram бота
 */
function startTelegramBot(botId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Получаем данные бота из БД
            const bot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: botId },
                include: { organization: true },
            });
            if (!bot) {
                throw new Error(`Telegram бот с ID ${botId} не найден`);
            }
            if (activeBots.has(botId)) {
                logger.info(`[Telegram] Бот ${bot.botUsername} уже запущен`);
                return;
            }
            // Создаём экземпляр бота
            const telegram = new node_telegram_bot_api_1.default(bot.botToken, {
                polling: true,
            });
            // Сохраняем экземпляр
            activeBots.set(botId, telegram);
            logger.info(`[Telegram] Запуск бота ${bot.botUsername} (ID: ${botId})`);
            // Получаем информацию о боте
            const botInfo = yield telegram.getMe();
            // Обновляем информацию в БД
            yield authStorage_1.prisma.telegramBot.update({
                where: { id: botId },
                data: {
                    botUsername: botInfo.username,
                    botName: `${botInfo.first_name || ''}`,
                    botId: botInfo.id.toString(),
                    status: 'active',
                    lastActiveAt: new Date(),
                },
            });
            logger.info(`[Telegram] Бот @${botInfo.username} успешно запущен`);
            // === ОБРАБОТЧИКИ СОБЫТИЙ ===
            // Обработка команды /start
            telegram.onText(/\/start/, (msg) => __awaiter(this, void 0, void 0, function* () {
                yield handleStartCommand(telegram, msg, bot.organizationId, botId);
            }));
            // Обработка текстовых сообщений
            telegram.on('message', (msg) => __awaiter(this, void 0, void 0, function* () {
                var _a;
                // Пропускаем команды (они обрабатываются отдельно)
                if ((_a = msg.text) === null || _a === void 0 ? void 0 : _a.startsWith('/'))
                    return;
                yield handleIncomingMessage(telegram, msg, bot.organizationId, botId);
            }));
            // Обработка фото
            telegram.on('photo', (msg) => __awaiter(this, void 0, void 0, function* () {
                yield handleIncomingMessage(telegram, msg, bot.organizationId, botId);
            }));
            // Обработка документов
            telegram.on('document', (msg) => __awaiter(this, void 0, void 0, function* () {
                yield handleIncomingMessage(telegram, msg, bot.organizationId, botId);
            }));
            // Обработка видео
            telegram.on('video', (msg) => __awaiter(this, void 0, void 0, function* () {
                yield handleIncomingMessage(telegram, msg, bot.organizationId, botId);
            }));
            // Обработка голосовых сообщений
            telegram.on('voice', (msg) => __awaiter(this, void 0, void 0, function* () {
                yield handleIncomingMessage(telegram, msg, bot.organizationId, botId);
            }));
            // Обработка ошибок
            telegram.on('polling_error', (error) => {
                logger.error(`[Telegram] Ошибка polling для бота ID ${botId}:`, error);
            });
            telegram.on('error', (error) => __awaiter(this, void 0, void 0, function* () {
                logger.error(`[Telegram] Ошибка бота ID ${botId}:`, error);
                // Обновляем статус в БД
                yield authStorage_1.prisma.telegramBot.update({
                    where: { id: botId },
                    data: { status: 'error' },
                });
            }));
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка запуска бота ID ${botId}:`, error);
            // Обновляем статус в БД
            yield authStorage_1.prisma.telegramBot.update({
                where: { id: botId },
                data: { status: 'error' },
            });
            throw error;
        }
    });
}
/**
 * Останавливает Telegram бота
 */
function stopTelegramBot(botId) {
    return __awaiter(this, void 0, void 0, function* () {
        const telegram = activeBots.get(botId);
        if (!telegram) {
            logger.warn(`[Telegram] Бот ID ${botId} не запущен`);
            return;
        }
        try {
            yield telegram.stopPolling();
            activeBots.delete(botId);
            yield authStorage_1.prisma.telegramBot.update({
                where: { id: botId },
                data: { status: 'inactive' },
            });
            logger.info(`[Telegram] Бот ID ${botId} остановлен`);
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка остановки бота ID ${botId}:`, error);
            throw error;
        }
    });
}
/**
 * Получает экземпляр активного бота
 */
function getTelegramBot(botId) {
    return activeBots.get(botId);
}
/**
 * Обработка команды /start
 */
function handleStartCommand(telegram, msg, organizationId, botId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            const chatId = msg.chat.id.toString();
            const userId = (_a = msg.from) === null || _a === void 0 ? void 0 : _a.id.toString();
            const username = (_b = msg.from) === null || _b === void 0 ? void 0 : _b.username;
            const firstName = (_c = msg.from) === null || _c === void 0 ? void 0 : _c.first_name;
            const lastName = (_d = msg.from) === null || _d === void 0 ? void 0 : _d.last_name;
            logger.info(`[Telegram] /start от пользователя ${username || userId} в чате ${chatId}`);
            // Создаём или находим чат
            yield ensureTelegramChat(organizationId, botId, chatId, userId, username, firstName, lastName);
            // Получаем приветственное сообщение
            const bot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: botId },
            });
            const welcomeMessage = (bot === null || bot === void 0 ? void 0 : bot.welcomeMessage) ||
                `👋 Привет! Я бот поддержки. Напишите ваш вопрос, и я передам его оператору.`;
            yield telegram.sendMessage(chatId, welcomeMessage);
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка обработки /start:`, error);
        }
    });
}
/**
 * Обработка входящего сообщения
 */
function handleIncomingMessage(telegram, msg, organizationId, botId) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d;
        try {
            const chatId = msg.chat.id.toString();
            const userId = (_a = msg.from) === null || _a === void 0 ? void 0 : _a.id.toString();
            const username = (_b = msg.from) === null || _b === void 0 ? void 0 : _b.username;
            const firstName = (_c = msg.from) === null || _c === void 0 ? void 0 : _c.first_name;
            const lastName = (_d = msg.from) === null || _d === void 0 ? void 0 : _d.last_name;
            const messageId = msg.message_id;
            // Создаём или находим чат
            const chat = yield ensureTelegramChat(organizationId, botId, chatId, userId, username, firstName, lastName);
            // --- АВТОМАТИЧЕСКОЕ СОЗДАНИЕ КЛИЕНТА (ВРЕМЕННО ОТКЛЮЧЕНО) ---
            // try {
            //   logger.info(`👤 Проверка клиента Telegram для UserID: ${userId}...`);
            //   const { ensureTelegramClient, linkClientToChat } = await import('./clientService');
            //   if (userId) {
            //     const client = await ensureTelegramClient(
            //       organizationId,
            //       userId,
            //       username,
            //       firstName,
            //       lastName
            //     );
            //     logger.info(`✅ Клиент Telegram обработан: ${client.name} (ID: ${client.id})`);
            //     
            //     // Связываем клиента с чатом
            //     await linkClientToChat(client.id, chat.id);
            //     logger.info(`🔗 Клиент #${client.id} связан с Telegram чатом #${chat.id}`);
            //   } else {
            //     logger.warn(`⚠️ Отсутствует userId для создания клиента Telegram`);
            //   }
            // } catch (clientError) {
            //   logger.error(`⚠️ Ошибка при создании клиента Telegram для ${username || userId}:`, clientError);
            //   // Продолжаем обработку сообщения даже если создание клиента не удалось
            // }
            // Определяем тип и содержимое сообщения
            let messageType = 'text';
            let content = '';
            let mediaUrl;
            let filename;
            let mimeType;
            let size;
            if (msg.text) {
                messageType = 'text';
                content = msg.text;
            }
            else if (msg.photo && msg.photo.length > 0) {
                messageType = 'image';
                content = msg.caption || '';
                const photo = msg.photo[msg.photo.length - 1]; // Берём фото лучшего качества
                size = photo.file_size;
                // Скачиваем и сохраняем в хранилище
                try {
                    const fileLink = yield telegram.getFileLink(photo.file_id);
                    const response = yield fetch(fileLink);
                    const buffer = Buffer.from(yield response.arrayBuffer());
                    const { saveMedia } = yield Promise.resolve().then(() => __importStar(require('./storageService')));
                    mediaUrl = yield saveMedia(buffer, `telegram-${photo.file_id}.jpg`, 'image/jpeg');
                    mimeType = 'image/jpeg';
                }
                catch (e) {
                    logger.error('[Telegram] Ошибка сохранения фото:', e);
                }
            }
            else if (msg.document) {
                messageType = 'document';
                content = msg.caption || '';
                filename = msg.document.file_name;
                mimeType = msg.document.mime_type;
                size = msg.document.file_size;
                try {
                    const fileLink = yield telegram.getFileLink(msg.document.file_id);
                    const response = yield fetch(fileLink);
                    const buffer = Buffer.from(yield response.arrayBuffer());
                    const { saveMedia } = yield Promise.resolve().then(() => __importStar(require('./storageService')));
                    mediaUrl = yield saveMedia(buffer, filename || `telegram-${msg.document.file_id}`, mimeType || 'application/octet-stream');
                }
                catch (e) {
                    logger.error('[Telegram] Ошибка сохранения документа:', e);
                }
            }
            else if (msg.video) {
                messageType = 'video';
                content = msg.caption || '';
                mimeType = msg.video.mime_type;
                size = msg.video.file_size;
                try {
                    const fileLink = yield telegram.getFileLink(msg.video.file_id);
                    const response = yield fetch(fileLink);
                    const buffer = Buffer.from(yield response.arrayBuffer());
                    const { saveMedia } = yield Promise.resolve().then(() => __importStar(require('./storageService')));
                    mediaUrl = yield saveMedia(buffer, `telegram-${msg.video.file_id}.mp4`, mimeType || 'video/mp4');
                }
                catch (e) {
                    logger.error('[Telegram] Ошибка сохранения видео:', e);
                }
            }
            else if (msg.voice) {
                messageType = 'audio';
                mimeType = msg.voice.mime_type;
                size = msg.voice.file_size;
                try {
                    const fileLink = yield telegram.getFileLink(msg.voice.file_id);
                    const response = yield fetch(fileLink);
                    const buffer = Buffer.from(yield response.arrayBuffer());
                    const { saveMedia } = yield Promise.resolve().then(() => __importStar(require('./storageService')));
                    mediaUrl = yield saveMedia(buffer, `telegram-${msg.voice.file_id}.ogg`, mimeType || 'audio/ogg');
                }
                catch (e) {
                    logger.error('[Telegram] Ошибка сохранения голосового:', e);
                }
            }
            // Сохраняем сообщение в БД
            yield authStorage_1.prisma.message.create({
                data: {
                    organizationId,
                    channel: 'telegram',
                    telegramBotId: botId,
                    telegramMessageId: messageId,
                    telegramChatId: chatId,
                    telegramUserId: userId,
                    telegramUsername: username,
                    chatId: chat.id,
                    fromMe: false,
                    content,
                    type: messageType,
                    mediaUrl,
                    filename,
                    mimeType,
                    size,
                    timestamp: new Date(msg.date * 1000),
                    status: 'delivered',
                },
            });
            // Обновляем чат
            yield authStorage_1.prisma.chat.update({
                where: { id: chat.id },
                data: {
                    lastMessageAt: new Date(),
                    unreadCount: { increment: 1 },
                },
            });
            logger.info(`[Telegram] Сохранено входящее сообщение от ${username || userId} в чат #${chat.id}`);
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка обработки входящего сообщения:`, error);
        }
    });
}
/**
 * Создаёт или находит чат в Telegram
 */
function ensureTelegramChat(organizationId, telegramBotId, telegramChatId, telegramUserId, telegramUsername, telegramFirstName, telegramLastName) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            // Пытаемся найти существующий чат
            let chat = yield authStorage_1.prisma.chat.findFirst({
                where: {
                    organizationId,
                    channel: 'telegram',
                    telegramBotId,
                    telegramChatId,
                },
            });
            if (!chat) {
                // Генерируем номер тикета
                const lastTicket = yield authStorage_1.prisma.chat.findFirst({
                    where: {
                        organizationId,
                        ticketNumber: { not: null },
                    },
                    orderBy: { ticketNumber: 'desc' },
                    select: { ticketNumber: true },
                });
                const nextTicketNumber = ((lastTicket === null || lastTicket === void 0 ? void 0 : lastTicket.ticketNumber) || 0) + 1;
                // Создаём новый чат
                chat = yield authStorage_1.prisma.chat.create({
                    data: {
                        organizationId,
                        channel: 'telegram',
                        telegramBotId,
                        telegramChatId,
                        telegramUserId,
                        telegramUsername,
                        telegramFirstName,
                        telegramLastName,
                        name: telegramUsername || `${telegramFirstName || ''} ${telegramLastName || ''}`.trim() || `User ${telegramUserId}`,
                        ticketNumber: nextTicketNumber,
                        status: 'new',
                        priority: 'medium',
                        lastMessageAt: new Date(),
                    },
                });
                logger.info(`[Telegram] Создан новый чат #${chat.id} для ${telegramUsername || telegramUserId}, тикет #${nextTicketNumber}`);
            }
            return chat;
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка создания/поиска чата:`, error);
            throw error;
        }
    });
}
/**
 * Отправка сообщения через Telegram бота
 */
function sendTelegramMessage(botId, chatId, content, options) {
    return __awaiter(this, void 0, void 0, function* () {
        const telegram = getTelegramBot(botId);
        if (!telegram) {
            throw new Error(`Telegram бот ID ${botId} не активен`);
        }
        try {
            const sendOptions = {};
            if (options === null || options === void 0 ? void 0 : options.replyToMessageId) {
                sendOptions.reply_to_message_id = options.replyToMessageId;
            }
            const sent = yield telegram.sendMessage(chatId, content, sendOptions);
            // Сохраняем отправленное сообщение в БД
            const chat = yield authStorage_1.prisma.chat.findFirst({
                where: {
                    channel: 'telegram',
                    telegramBotId: botId,
                    telegramChatId: chatId,
                },
            });
            if (chat) {
                yield authStorage_1.prisma.message.create({
                    data: {
                        organizationId: chat.organizationId,
                        channel: 'telegram',
                        telegramBotId: botId,
                        telegramMessageId: sent.message_id,
                        telegramChatId: chatId,
                        chatId: chat.id,
                        fromMe: true,
                        content,
                        type: 'text',
                        timestamp: new Date(sent.date * 1000),
                        status: 'sent',
                        senderUserId: options === null || options === void 0 ? void 0 : options.userId,
                    },
                });
                // Обновляем время последнего сообщения
                yield authStorage_1.prisma.chat.update({
                    where: { id: chat.id },
                    data: { lastMessageAt: new Date() },
                });
                logger.info(`[Telegram] Отправлено сообщение в чат ${chatId}, сохранено с senderUserId: ${(options === null || options === void 0 ? void 0 : options.userId) || 'не указан'}`);
            }
            logger.info(`[Telegram] Отправлено сообщение в чат ${chatId}`);
            return sent;
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка отправки сообщения:`, error);
            throw error;
        }
    });
}
/**
 * Запускает все активные боты организации
 */
function startAllTelegramBots() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const bots = yield authStorage_1.prisma.telegramBot.findMany({
                where: {
                    status: { in: ['active', 'inactive'] },
                },
            });
            logger.info(`[Telegram] Найдено ${bots.length} ботов для запуска`);
            for (const bot of bots) {
                try {
                    yield startTelegramBot(bot.id);
                }
                catch (error) {
                    logger.error(`[Telegram] Ошибка запуска бота ID ${bot.id}:`, error);
                }
            }
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка запуска всех ботов:`, error);
        }
    });
}
/**
 * Останавливает все боты
 */
function stopAllTelegramBots() {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const botIds = Array.from(activeBots.keys());
            for (const botId of botIds) {
                try {
                    yield stopTelegramBot(botId);
                }
                catch (error) {
                    logger.error(`[Telegram] Ошибка остановки бота ID ${botId}:`, error);
                }
            }
        }
        catch (error) {
            logger.error(`[Telegram] Ошибка остановки всех ботов:`, error);
        }
    });
}
//# sourceMappingURL=telegramService.js.map