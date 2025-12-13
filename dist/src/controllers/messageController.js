"use strict";
// src/controllers/messageController.ts
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
exports.sendMessageByChat = exports.sendMessageByTicket = exports.sendMediaMessage = exports.sendTextMessage = void 0;
const baileys_1 = require("../config/baileys");
const baileys_2 = require("@whiskeysockets/baileys");
const pino_1 = __importDefault(require("pino"));
const authStorage_1 = require("../config/authStorage"); // Для получения phoneJid
const logger = (0, pino_1.default)({ level: 'info' });
const sendTextMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { organizationPhoneId, receiverJid, text } = req.body;
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId; // <--- ПОЛУЧАЕМ ID ПОЛЬЗОВАТЕЛЯ
    // 1. Валидация входных данных
    if (!organizationPhoneId || !receiverJid || !text) {
        logger.warn('[sendTextMessage] Отсутствуют необходимые параметры: organizationPhoneId, receiverJid или text.');
        return res.status(400).json({ error: 'Missing organizationPhoneId, receiverJid, or text' });
    }
    // 2. Нормализация JID получателя
    // jidNormalizedUser может вернуть null, если JID невалидный.
    const normalizedReceiverJid = (0, baileys_2.jidNormalizedUser)(receiverJid);
    // --- НОВОЕ ИЗМЕНЕНИЕ: Проверка, что JID успешно нормализован ---
    if (!normalizedReceiverJid) {
        logger.error(`[sendTextMessage] Некорректный или ненормализуемый receiverJid: "${receiverJid}".`);
        return res.status(400).json({ error: 'Invalid receiverJid provided. Could not normalize WhatsApp ID.' });
    }
    // --- КОНЕЦ НОВОГО ИЗМЕНЕНИЯ ---
    // 3. Получение Baileys сокета
    const sock = (0, baileys_1.getBaileysSock)(organizationPhoneId);
    // 4. Проверка готовности сокета
    // Сокет готов к отправке, если он существует и успешно аутентифицирован (имеет объект user).
    if (!sock || !sock.user) {
        logger.warn(`[sendTextMessage] Попытка отправить сообщение, но сокет для ID ${organizationPhoneId} не готов (пользователь не авторизован или сокет отсутствует).`);
        const status = sock ? 'connecting/closed' : 'not found';
        return res.status(503).json({
            error: `WhatsApp аккаунт (ID: ${organizationPhoneId}) еще не полностью подключен или не готов к отправке сообщений. Текущий статус: ${status}. Попробуйте позже.`,
            details: 'Socket not ready or user not authenticated.'
        });
    }
    const organizationPhone = yield authStorage_1.prisma.organizationPhone.findUnique({
        where: { id: organizationPhoneId, organizationId: organizationId },
        select: { phoneJid: true }
    });
    if (!organizationPhone || !organizationPhone.phoneJid) {
        logger.error(`[sendTextMessage] Не удалось найти phoneJid для organizationPhoneId: ${organizationPhoneId} или он пуст.`);
        return res.status(404).json({ error: 'Sender WhatsApp account not found or not configured.' });
    }
    const senderJid = organizationPhone.phoneJid;
    // 5. Попытка отправить сообщение
    try {
        const sentMessage = yield (0, baileys_1.sendMessage)(sock, normalizedReceiverJid, { text }, organizationId, organizationPhoneId, senderJid, userId // <--- ПЕРЕДАЕМ ID ПОЛЬЗОВАТЕЛЯ
        );
        // 6. Проверка, что sentMessage не undefined
        // sock.sendMessage() может вернуть undefined в некоторых случаях, даже без выбрасывания ошибки.
        if (!sentMessage) {
            logger.error(`❌ Сообщение не было отправлено (sentMessage is undefined) на ${normalizedReceiverJid} с ID ${organizationPhoneId}.`);
            return res.status(500).json({ error: 'Failed to send message: WhatsApp API did not return a message object.', details: 'The message might not have been sent successfully.' });
        }
        // 7. Успешная отправка
        logger.info(`✅ Сообщение "${text}" отправлено на ${normalizedReceiverJid} с ID ${organizationPhoneId}. WhatsApp Message ID: ${sentMessage.key.id}`);
        return res.status(200).json({ success: true, messageId: sentMessage.key.id });
    }
    catch (error) {
        // 8. Обработка ошибок отправки
        logger.error(`❌ Критическая ошибка при отправке сообщения на ${normalizedReceiverJid} с ID ${organizationPhoneId}:`, error);
        return res.status(500).json({ error: 'Failed to send message due to an internal error.', details: error.message });
    }
});
exports.sendTextMessage = sendTextMessage;
/**
 * Отправляет медиафайл (изображение, видео, документ, аудио)
 */
const sendMediaMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { organizationPhoneId, receiverJid, mediaType, mediaPath, caption, filename } = req.body;
    const organizationId = res.locals.organizationId;
    const userId = res.locals.userId;
    // 1. Валидация входных данных
    if (!organizationPhoneId || !receiverJid || !mediaType || !mediaPath) {
        logger.warn('[sendMediaMessage] Отсутствуют необходимые параметры: organizationPhoneId, receiverJid, mediaType или mediaPath.');
        return res.status(400).json({ error: 'Missing organizationPhoneId, receiverJid, mediaType, or mediaPath' });
    }
    // 2. Проверка типа медиа
    const allowedMediaTypes = ['image', 'video', 'document', 'audio'];
    if (!allowedMediaTypes.includes(mediaType)) {
        logger.warn(`[sendMediaMessage] Неподдерживаемый тип медиа: "${mediaType}"`);
        return res.status(400).json({ error: `Unsupported media type. Allowed types: ${allowedMediaTypes.join(', ')}` });
    }
    // 3. Нормализация JID получателя
    const normalizedReceiverJid = (0, baileys_2.jidNormalizedUser)(receiverJid);
    if (!normalizedReceiverJid) {
        logger.error(`[sendMediaMessage] Некорректный или ненормализуемый receiverJid: "${receiverJid}".`);
        return res.status(400).json({ error: 'Invalid receiverJid provided. Could not normalize WhatsApp ID.' });
    }
    // 4. Получение Baileys сокета
    const sock = (0, baileys_1.getBaileysSock)(organizationPhoneId);
    if (!sock || !sock.user) {
        logger.warn(`[sendMediaMessage] Попытка отправить медиа, но сокет для ID ${organizationPhoneId} не готов.`);
        const status = sock ? 'connecting/closed' : 'not found';
        return res.status(503).json({
            error: `WhatsApp аккаунт (ID: ${organizationPhoneId}) еще не полностью подключен. Текущий статус: ${status}. Попробуйте позже.`,
        });
    }
    // 5. Получение информации об отправителе
    const organizationPhone = yield authStorage_1.prisma.organizationPhone.findUnique({
        where: { id: organizationPhoneId, organizationId: organizationId },
        select: { phoneJid: true }
    });
    if (!organizationPhone || !organizationPhone.phoneJid) {
        logger.error(`[sendMediaMessage] Не удалось найти phoneJid для organizationPhoneId: ${organizationPhoneId}`);
        return res.status(404).json({ error: 'Sender WhatsApp account not found or not configured.' });
    }
    const senderJid = organizationPhone.phoneJid;
    try {
        // 6. Подготовка контента для отправки
        let messageContent;
        // Проверяем, является ли mediaPath URL или локальным путем
        const isUrl = mediaPath.startsWith('http://') || mediaPath.startsWith('https://');
        if (isUrl) {
            // Если это URL, отправляем как ссылку
            switch (mediaType) {
                case 'image':
                    messageContent = {
                        image: { url: mediaPath },
                        caption: caption || '',
                    };
                    break;
                case 'video':
                    messageContent = {
                        video: { url: mediaPath },
                        caption: caption || '',
                    };
                    break;
                case 'document':
                    messageContent = {
                        document: { url: mediaPath },
                        fileName: filename || 'document',
                        caption: caption || '',
                    };
                    break;
                case 'audio':
                    messageContent = {
                        audio: { url: mediaPath },
                        mimetype: 'audio/mp4', // или другой подходящий MIME тип
                    };
                    break;
            }
        }
        else {
            // Если это локальный путь, читаем файл
            const fs = require('fs');
            const path = require('path');
            // Определяем полный путь к файлу
            const fullPath = path.isAbsolute(mediaPath) ? mediaPath : path.join(process.cwd(), mediaPath);
            // Проверяем существование файла
            if (!fs.existsSync(fullPath)) {
                logger.error(`[sendMediaMessage] Файл не найден: ${fullPath}`);
                return res.status(404).json({ error: 'Media file not found' });
            }
            // Читаем файл
            const fileBuffer = fs.readFileSync(fullPath);
            switch (mediaType) {
                case 'image':
                    messageContent = {
                        image: fileBuffer,
                        caption: caption || '',
                    };
                    break;
                case 'video':
                    messageContent = {
                        video: fileBuffer,
                        caption: caption || '',
                    };
                    break;
                case 'document':
                    messageContent = {
                        document: fileBuffer,
                        fileName: filename || path.basename(fullPath),
                        caption: caption || '',
                    };
                    break;
                case 'audio':
                    messageContent = {
                        audio: fileBuffer,
                        mimetype: 'audio/mp4',
                    };
                    break;
            }
        }
        // 7. Отправка медиафайла
        const sentMessage = yield (0, baileys_1.sendMessage)(sock, normalizedReceiverJid, messageContent, organizationId, organizationPhoneId, senderJid, userId);
        if (!sentMessage) {
            logger.error(`❌ Медиафайл не был отправлен (sentMessage is undefined) на ${normalizedReceiverJid}`);
            return res.status(500).json({ error: 'Failed to send media: WhatsApp API did not return a message object.' });
        }
        // 8. Успешная отправка
        logger.info(`✅ Медиафайл типа "${mediaType}" отправлен на ${normalizedReceiverJid} с ID ${organizationPhoneId}. WhatsApp Message ID: ${sentMessage.key.id}`);
        return res.status(200).json({
            success: true,
            messageId: sentMessage.key.id,
            mediaType: mediaType,
            caption: caption || null,
        });
    }
    catch (error) {
        logger.error(`❌ Критическая ошибка при отправке медиафайла на ${normalizedReceiverJid}:`, error);
        return res.status(500).json({ error: 'Failed to send media due to an internal error.', details: error.message });
    }
});
exports.sendMediaMessage = sendMediaMessage;
/**
 * Отправить текстовое сообщение по номеру тикета
 */
const sendMessageByTicket = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const organizationId = res.locals.organizationId;
        const userId = res.locals.userId;
        const { ticketNumber, text } = req.body;
        // Валидация
        if (!organizationId) {
            logger.warn('[sendMessageByTicket] Несанкционированный доступ: organizationId не определен в res.locals.');
            return res.status(401).json({ error: 'Несанкционированный доступ: organizationId не определен.' });
        }
        if (!ticketNumber || isNaN(parseInt(ticketNumber))) {
            logger.warn(`[sendMessageByTicket] Некорректный ticketNumber: "${ticketNumber}". Ожидалось число.`);
            return res.status(400).json({ error: 'Некорректный ticketNumber. Ожидалось число.' });
        }
        if (!text || typeof text !== 'string' || text.trim() === '') {
            logger.warn('[sendMessageByTicket] Отсутствует или пустой параметр text.');
            return res.status(400).json({ error: 'Параметр text обязателен и не должен быть пустым.' });
        }
        // Находим чат по ticketNumber
        const chat = yield authStorage_1.prisma.chat.findFirst({
            where: {
                ticketNumber: parseInt(ticketNumber),
                organizationId: organizationId,
            },
            select: {
                id: true,
                remoteJid: true,
                receivingPhoneJid: true,
                organizationPhoneId: true,
            },
        });
        if (!chat) {
            logger.warn(`[sendMessageByTicket] Тикет с номером ${ticketNumber} не найден или не принадлежит организации ${organizationId}.`);
            return res.status(404).json({ error: 'Тикет не найден или не принадлежит вашей организации.' });
        }
        if (!chat.remoteJid || !chat.receivingPhoneJid || !chat.organizationPhoneId) {
            logger.error(`[sendMessageByTicket] У тикета ${ticketNumber} отсутствуют необходимые данные (remoteJid, receivingPhoneJid или organizationPhoneId).`);
            return res.status(500).json({ error: 'У тикета отсутствуют необходимые данные для отправки сообщения.' });
        }
        // Получаем сокет Baileys
        const sock = (0, baileys_1.getBaileysSock)(chat.organizationPhoneId);
        if (!sock || !sock.user) {
            logger.warn(`[sendMessageByTicket] Сокет для organizationPhoneId ${chat.organizationPhoneId} не готов.`);
            return res.status(503).json({
                error: `WhatsApp аккаунт не готов к отправке сообщений. Попробуйте позже.`,
                details: 'Socket not ready or user not authenticated.'
            });
        }
        // Нормализуем JID получателя
        const normalizedReceiverJid = (0, baileys_2.jidNormalizedUser)(chat.remoteJid);
        if (!normalizedReceiverJid) {
            logger.error(`[sendMessageByTicket] Некорректный remoteJid: "${chat.remoteJid}".`);
            return res.status(500).json({ error: 'Некорректный remoteJid в базе данных.' });
        }
        // Отправляем сообщение
        const sentMessage = yield (0, baileys_1.sendMessage)(sock, normalizedReceiverJid, { text }, organizationId, chat.organizationPhoneId, chat.receivingPhoneJid, userId);
        if (!sentMessage) {
            logger.error(`[sendMessageByTicket] Сообщение не было отправлено (sentMessage is undefined) для тикета ${ticketNumber}.`);
            return res.status(500).json({ error: 'Не удалось отправить сообщение.', details: 'The message might not have been sent successfully.' });
        }
        logger.info(`[sendMessageByTicket] Сообщение отправлено в тикет ${ticketNumber}. WhatsApp Message ID: ${sentMessage.key.id}`);
        res.status(200).json({ success: true, messageId: sentMessage.key.id, ticketNumber: parseInt(ticketNumber) });
    }
    catch (error) {
        logger.error(`[sendMessageByTicket] Ошибка при отправке сообщения в тикет:`, error);
        res.status(500).json({
            error: 'Не удалось отправить сообщение в тикет.',
            details: error.message,
        });
    }
});
exports.sendMessageByTicket = sendMessageByTicket;
/**
 * Универсальный эндпоинт для отправки сообщений по chatId
 * Автоматически определяет тип подключения (Baileys или WABA) и использует соответствующий сервис
 * POST /api/messages/send-by-chat
 */
const sendMessageByChat = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f;
    try {
        const organizationId = res.locals.organizationId;
        const userId = res.locals.userId;
        const { chatId, text, type = 'text', mediaUrl, caption, filename, template } = req.body;
        // Валидация
        if (!chatId || isNaN(parseInt(chatId))) {
            logger.warn(`[sendMessageByChat] Некорректный chatId: "${chatId}". Ожидалось число.`);
            return res.status(400).json({ error: 'Некорректный chatId. Ожидалось число.' });
        }
        if (type === 'text' && (!text || typeof text !== 'string' || text.trim() === '')) {
            logger.warn('[sendMessageByChat] Отсутствует или пустой параметр text для типа text.');
            return res.status(400).json({ error: 'Параметр text обязателен для типа text.' });
        }
        if ((type === 'image' || type === 'document' || type === 'video' || type === 'audio') && !mediaUrl) {
            logger.warn(`[sendMessageByChat] Отсутствует mediaUrl для типа ${type}.`);
            return res.status(400).json({ error: `Параметр mediaUrl обязателен для типа ${type}.` });
        }
        if (type === 'template' && (!template || !template.name)) {
            logger.warn('[sendMessageByChat] Отсутствует template объект для типа template.');
            return res.status(400).json({ error: 'Параметр template с полем name обязателен для типа template.' });
        }
        // Находим чат с информацией о типе подключения и канале
        const chat = yield authStorage_1.prisma.chat.findFirst({
            where: {
                id: parseInt(chatId),
                organizationId: organizationId,
            },
            include: {
                organizationPhone: {
                    select: {
                        id: true,
                        phoneJid: true,
                        connectionType: true,
                        wabaAccessToken: true,
                        wabaPhoneNumberId: true,
                    },
                },
                telegramBot: {
                    select: {
                        id: true,
                        botUsername: true,
                    },
                },
            },
        });
        if (!chat) {
            logger.warn(`[sendMessageByChat] Чат с ID ${chatId} не найден или не принадлежит организации ${organizationId}.`);
            return res.status(404).json({ error: 'Чат не найден или не принадлежит вашей организации.' });
        }
        const channel = chat.channel;
        let sentMessage;
        let messageContent = '';
        // Определяем метод отправки в зависимости от канала
        if (channel === 'telegram') {
            // Используем Telegram Bot API
            logger.info(`[sendMessageByChat] Используем Telegram для чата ${chatId}`);
            if (!chat.telegramBot || !chat.telegramChatId) {
                logger.error(`[sendMessageByChat] У чата ${chatId} отсутствует telegramBot или telegramChatId.`);
                return res.status(500).json({ error: 'У чата отсутствует привязка к Telegram боту.' });
            }
            const { sendTelegramMessage } = yield Promise.resolve().then(() => __importStar(require('../services/telegramService')));
            // Telegram поддерживает только текстовые сообщения через этот эндпоинт
            if (type !== 'text') {
                return res.status(400).json({
                    error: `Тип ${type} пока не поддерживается для Telegram через этот эндпоинт. Используйте специализированные методы Telegram Bot API.`
                });
            }
            try {
                sentMessage = yield sendTelegramMessage(chat.telegramBot.id, chat.telegramChatId, text, { userId });
                logger.info(`[sendMessageByChat] Telegram сообщение отправлено в чат ${chatId}, messageId: ${sentMessage.message_id}`);
                return res.status(200).json({
                    success: true,
                    messageId: sentMessage.message_id,
                    chatId: chat.id,
                    channel: 'telegram',
                });
            }
            catch (error) {
                logger.error(`[sendMessageByChat] Ошибка отправки Telegram сообщения:`, error);
                return res.status(500).json({
                    error: 'Не удалось отправить сообщение через Telegram.',
                    details: error.message
                });
            }
        }
        else if (channel === 'whatsapp') {
            // WhatsApp: определяем тип подключения (Baileys или WABA)
            if (!chat.organizationPhone) {
                logger.error(`[sendMessageByChat] У чата ${chatId} отсутствует organizationPhone.`);
                return res.status(500).json({ error: 'У чата отсутствует привязка к телефону организации.' });
            }
            const connectionType = chat.organizationPhone.connectionType || 'baileys';
            if (connectionType === 'waba') {
                // Используем WABA API
                logger.info(`[sendMessageByChat] Используем WABA для чата ${chatId}`);
                const { createWABAService } = yield Promise.resolve().then(() => __importStar(require('../services/wabaService')));
                const wabaService = yield createWABAService(chat.organizationPhone.id);
                if (!wabaService) {
                    logger.error(`[sendMessageByChat] WABA сервис не настроен для organizationPhoneId ${chat.organizationPhone.id}`);
                    return res.status(500).json({ error: 'WABA сервис не настроен для этого телефона.' });
                }
                const recipientPhone = chat.remoteJid.replace('@s.whatsapp.net', '');
                // Отправляем через WABA в зависимости от типа
                switch (type) {
                    case 'text':
                        sentMessage = yield wabaService.sendTextMessage(recipientPhone, text);
                        messageContent = text;
                        break;
                    case 'image':
                        sentMessage = yield wabaService.sendImage(recipientPhone, mediaUrl, caption);
                        messageContent = caption || '[Image]';
                        break;
                    case 'document':
                        sentMessage = yield wabaService.sendDocument(recipientPhone, mediaUrl, filename, caption);
                        messageContent = caption || `[Document: ${filename || 'file'}]`;
                        break;
                    case 'video':
                        sentMessage = yield wabaService.sendMessage({
                            to: recipientPhone,
                            type: 'video',
                            video: { link: mediaUrl, caption }
                        });
                        messageContent = caption || '[Video]';
                        break;
                    case 'audio':
                        sentMessage = yield wabaService.sendMessage({
                            to: recipientPhone,
                            type: 'audio',
                            audio: { link: mediaUrl }
                        });
                        messageContent = '[Audio]';
                        break;
                    case 'template':
                        sentMessage = yield wabaService.sendTemplateMessage(recipientPhone, template.name, template.language || 'ru', template.components);
                        messageContent = `Template: ${template.name}`;
                        break;
                    default:
                        return res.status(400).json({ error: `Неподдерживаемый тип сообщения: ${type}` });
                }
                // Сохраняем сообщение в БД
                const savedMessage = yield authStorage_1.prisma.message.create({
                    data: {
                        chatId: chat.id,
                        organizationPhoneId: chat.organizationPhone.id,
                        organizationId: chat.organizationId,
                        channel: 'whatsapp',
                        whatsappMessageId: (_b = (_a = sentMessage.messages) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.id,
                        receivingPhoneJid: chat.organizationPhone.phoneJid,
                        remoteJid: chat.remoteJid,
                        senderJid: chat.organizationPhone.phoneJid,
                        fromMe: true,
                        content: messageContent,
                        mediaUrl: mediaUrl || null,
                        type: type,
                        timestamp: new Date(),
                        status: 'sent',
                        senderUserId: userId,
                        isReadByOperator: true,
                    },
                });
                // Обновляем lastMessageAt
                yield authStorage_1.prisma.chat.update({
                    where: { id: chat.id },
                    data: { lastMessageAt: new Date() },
                });
                logger.info(`[sendMessageByChat] WABA сообщение отправлено в чат ${chatId}, messageId: ${(_d = (_c = sentMessage.messages) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.id}`);
                return res.status(200).json({
                    success: true,
                    messageId: (_f = (_e = sentMessage.messages) === null || _e === void 0 ? void 0 : _e[0]) === null || _f === void 0 ? void 0 : _f.id,
                    chatId: chat.id,
                    channel: 'whatsapp',
                    connectionType: 'waba',
                    message: savedMessage,
                });
            }
            else {
                // Используем Baileys
                logger.info(`[sendMessageByChat] Используем Baileys для чата ${chatId}`);
                const sock = (0, baileys_1.getBaileysSock)(chat.organizationPhone.id);
                if (!sock || !sock.user) {
                    logger.warn(`[sendMessageByChat] Baileys сокет для organizationPhoneId ${chat.organizationPhone.id} не готов.`);
                    return res.status(503).json({
                        error: 'WhatsApp аккаунт не готов к отправке сообщений. Попробуйте позже.',
                        details: 'Socket not ready or user not authenticated.'
                    });
                }
                const normalizedReceiverJid = (0, baileys_2.jidNormalizedUser)(chat.remoteJid);
                if (!normalizedReceiverJid) {
                    logger.error(`[sendMessageByChat] Некорректный remoteJid: "${chat.remoteJid}".`);
                    return res.status(500).json({ error: 'Некорректный remoteJid в базе данных.' });
                }
                // Для Baileys поддерживаем только text и media (не template)
                let messageContentObj;
                switch (type) {
                    case 'text':
                        messageContentObj = { text };
                        break;
                    case 'image':
                    case 'document':
                    case 'video':
                    case 'audio':
                        return res.status(400).json({
                            error: `Тип ${type} пока не поддерживается для Baileys через этот эндпоинт. Используйте /send-media.`
                        });
                    case 'template':
                        return res.status(400).json({
                            error: 'Шаблоны не поддерживаются для Baileys подключений. Используйте только WABA.'
                        });
                    default:
                        return res.status(400).json({ error: `Неподдерживаемый тип сообщения: ${type}` });
                }
                sentMessage = yield (0, baileys_1.sendMessage)(sock, normalizedReceiverJid, messageContentObj, organizationId, chat.organizationPhone.id, chat.organizationPhone.phoneJid, userId);
                if (!sentMessage) {
                    logger.error(`[sendMessageByChat] Baileys сообщение не было отправлено для чата ${chatId}.`);
                    return res.status(500).json({ error: 'Не удалось отправить сообщение.' });
                }
                logger.info(`[sendMessageByChat] Baileys сообщение отправлено в чат ${chatId}, messageId: ${sentMessage.key.id}`);
                return res.status(200).json({
                    success: true,
                    messageId: sentMessage.key.id,
                    chatId: chat.id,
                    channel: 'whatsapp',
                    connectionType: 'baileys',
                });
            }
        }
        else {
            // Неизвестный канал
            logger.error(`[sendMessageByChat] Неподдерживаемый канал: ${channel}`);
            return res.status(400).json({ error: `Неподдерживаемый канал: ${channel}` });
        }
    }
    catch (error) {
        logger.error(`[sendMessageByChat] Ошибка при отправке сообщения:`, error);
        res.status(500).json({
            error: 'Не удалось отправить сообщение.',
            details: error.message,
        });
    }
});
exports.sendMessageByChat = sendMessageByChat;
//# sourceMappingURL=messageController.js.map