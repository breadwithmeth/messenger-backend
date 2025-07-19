"use strict";
// src/controllers/messageController.ts
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
exports.sendMediaMessage = exports.sendTextMessage = void 0;
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
//# sourceMappingURL=messageController.js.map