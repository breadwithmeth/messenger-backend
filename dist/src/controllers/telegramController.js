"use strict";
// src/controllers/telegramController.ts
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
exports.listBots = listBots;
exports.getBot = getBot;
exports.createBot = createBot;
exports.updateBot = updateBot;
exports.deleteBot = deleteBot;
exports.startBot = startBot;
exports.stopBot = stopBot;
exports.sendMessage = sendMessage;
exports.getBotChats = getBotChats;
const authStorage_1 = require("../config/authStorage");
const telegramService_1 = require("../services/telegramService");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
/**
 * Получить список всех ботов организации
 */
function listBots(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { organizationId } = req.params;
            const bots = yield authStorage_1.prisma.telegramBot.findMany({
                where: {
                    organizationId: parseInt(organizationId),
                },
                orderBy: { createdAt: 'desc' },
            });
            res.json({ bots });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка получения списка ботов:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Получить информацию о конкретном боте
 */
function getBot(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { botId } = req.params;
            const bot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: parseInt(botId) },
                include: {
                    organization: {
                        select: {
                            id: true,
                            name: true,
                        },
                    },
                },
            });
            if (!bot) {
                res.status(404).json({ error: 'Бот не найден' });
                return;
            }
            // Проверяем, активен ли бот
            const isActive = (0, telegramService_1.getTelegramBot)(bot.id) !== undefined;
            res.json({
                bot: Object.assign(Object.assign({}, bot), { isRunning: isActive }),
            });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка получения бота:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Создать нового бота
 */
function createBot(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { organizationId } = req.params;
            const { botToken, welcomeMessage, autoStart } = req.body;
            if (!botToken) {
                res.status(400).json({ error: 'Не указан токен бота' });
                return;
            }
            // Проверяем, не существует ли уже бот с таким токеном
            const existingBot = yield authStorage_1.prisma.telegramBot.findFirst({
                where: { botToken },
            });
            if (existingBot) {
                res.status(400).json({ error: 'Бот с таким токеном уже существует' });
                return;
            }
            // Создаём бота в БД
            const bot = yield authStorage_1.prisma.telegramBot.create({
                data: {
                    organizationId: parseInt(organizationId),
                    botToken,
                    welcomeMessage: welcomeMessage || undefined,
                    status: 'inactive',
                },
            });
            logger.info(`[Telegram API] Создан новый бот ID ${bot.id}`);
            // Автозапуск, если указано
            if (autoStart) {
                try {
                    yield (0, telegramService_1.startTelegramBot)(bot.id);
                }
                catch (error) {
                    logger.error(`[Telegram API] Ошибка автозапуска бота ID ${bot.id}:`, error);
                    // Не фейлим весь запрос, просто логируем ошибку
                }
            }
            // Получаем обновлённые данные
            const updatedBot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: bot.id },
            });
            res.status(201).json({ bot: updatedBot });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка создания бота:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Обновить настройки бота
 */
function updateBot(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { botId } = req.params;
            const { botToken, welcomeMessage, autoReply, webhookUrl } = req.body;
            const bot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: parseInt(botId) },
            });
            if (!bot) {
                res.status(404).json({ error: 'Бот не найден' });
                return;
            }
            // Если меняется токен, нужно перезапустить бота
            const needsRestart = botToken && botToken !== bot.botToken;
            if (needsRestart) {
                // Останавливаем старого бота
                yield (0, telegramService_1.stopTelegramBot)(bot.id);
            }
            // Обновляем данные
            const updatedBot = yield authStorage_1.prisma.telegramBot.update({
                where: { id: parseInt(botId) },
                data: {
                    botToken: botToken || undefined,
                    welcomeMessage: welcomeMessage !== undefined ? welcomeMessage : undefined,
                    autoReply: autoReply !== undefined ? autoReply : undefined,
                    webhookUrl: webhookUrl !== undefined ? webhookUrl : undefined,
                },
            });
            // Перезапускаем, если был активен
            if (needsRestart && bot.status === 'active') {
                try {
                    yield (0, telegramService_1.startTelegramBot)(updatedBot.id);
                }
                catch (error) {
                    logger.error(`[Telegram API] Ошибка перезапуска бота ID ${botId}:`, error);
                }
            }
            res.json({ bot: updatedBot });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка обновления бота:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Удалить бота
 */
function deleteBot(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { botId } = req.params;
            const bot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: parseInt(botId) },
            });
            if (!bot) {
                res.status(404).json({ error: 'Бот не найден' });
                return;
            }
            // Останавливаем бота, если запущен
            yield (0, telegramService_1.stopTelegramBot)(bot.id);
            // Удаляем из БД
            yield authStorage_1.prisma.telegramBot.delete({
                where: { id: parseInt(botId) },
            });
            logger.info(`[Telegram API] Удалён бот ID ${botId}`);
            res.json({ success: true });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка удаления бота:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Запустить бота
 */
function startBot(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { botId } = req.params;
            yield (0, telegramService_1.startTelegramBot)(parseInt(botId));
            const bot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: parseInt(botId) },
            });
            res.json({ bot });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка запуска бота:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Остановить бота
 */
function stopBot(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { botId } = req.params;
            yield (0, telegramService_1.stopTelegramBot)(parseInt(botId));
            const bot = yield authStorage_1.prisma.telegramBot.findUnique({
                where: { id: parseInt(botId) },
            });
            res.json({ bot });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка остановки бота:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Отправить сообщение через бота
 */
function sendMessage(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { botId } = req.params;
            const { chatId, content, replyToMessageId } = req.body;
            if (!chatId || !content) {
                res.status(400).json({ error: 'Не указаны chatId или content' });
                return;
            }
            // Получаем userId из res.locals (устанавливается middleware аутентификации)
            const userId = res.locals.userId;
            const sent = yield (0, telegramService_1.sendTelegramMessage)(parseInt(botId), chatId, content, {
                replyToMessageId,
                userId,
            });
            res.json({
                success: true,
                messageId: sent.message_id,
                timestamp: new Date(sent.date * 1000),
            });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка отправки сообщения:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
/**
 * Получить чаты Telegram бота
 */
function getBotChats(req, res) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const { botId } = req.params;
            const { limit = 50, offset = 0, status } = req.query;
            const where = {
                channel: 'telegram',
                telegramBotId: parseInt(botId),
            };
            if (status && typeof status === 'string') {
                where.status = status;
            }
            const [chats, total] = yield Promise.all([
                authStorage_1.prisma.chat.findMany({
                    where,
                    orderBy: { lastMessageAt: 'desc' },
                    take: parseInt(limit),
                    skip: parseInt(offset),
                    include: {
                        assignedUser: {
                            select: {
                                id: true,
                                name: true,
                            },
                        },
                        _count: {
                            select: { messages: true },
                        },
                    },
                }),
                authStorage_1.prisma.chat.count({ where }),
            ]);
            res.json({
                chats,
                total,
                limit: parseInt(limit),
                offset: parseInt(offset),
            });
        }
        catch (error) {
            logger.error('[Telegram API] Ошибка получения чатов бота:', error);
            res.status(500).json({ error: error.message });
        }
    });
}
//# sourceMappingURL=telegramController.js.map