"use strict";
// src/controllers/wabaController.ts
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
exports.getTemplates = exports.getChatMessages = exports.getMessageStatus = exports.operatorSendMessage = exports.sendMessage = exports.handleWebhook = exports.verifyWebhook = void 0;
const wabaService_1 = require("../services/wabaService");
const authStorage_1 = require("../config/authStorage");
const baileys_1 = require("../config/baileys");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
/**
 * Webhook verification для WhatsApp Business API
 * GET /api/waba/webhook
 */
const verifyWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const mode = req.query['hub.mode'];
        const token = req.query['hub.verify_token'];
        const challenge = req.query['hub.challenge'];
        logger.info('🔍 WABA: Webhook verification request', {
            mode,
            receivedToken: token,
            challenge,
            expectedToken: process.env.WABA_VERIFY_TOKEN
        });
        // Получаем verify token из параметра или переменной окружения
        const expectedToken = process.env.WABA_VERIFY_TOKEN || 'your_verify_token';
        if (mode === 'subscribe' && token === expectedToken) {
            logger.info('✅ WABA: Webhook verification successful');
            return res.status(200).send(challenge);
        }
        else {
            logger.warn('⚠️ WABA: Webhook verification failed', {
                modeMatch: mode === 'subscribe',
                tokenMatch: token === expectedToken
            });
            return res.sendStatus(403);
        }
    }
    catch (error) {
        logger.error('❌ WABA: Webhook verification error:', error);
        return res.sendStatus(500);
    }
});
exports.verifyWebhook = verifyWebhook;
/**
 * Обработка входящих webhook событий от WhatsApp Business API
 * POST /api/waba/webhook
 */
const handleWebhook = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const body = req.body;
        // Быстро отвечаем 200 OK
        res.sendStatus(200);
        // Обрабатываем webhook асинхронно
        if (body.object === 'whatsapp_business_account') {
            for (const entry of body.entry) {
                for (const change of entry.changes) {
                    yield processWebhookChange(change);
                }
            }
        }
    }
    catch (error) {
        logger.error('❌ WABA: Webhook processing error:', error);
    }
});
exports.handleWebhook = handleWebhook;
/**
 * Обработка изменений из webhook
 */
function processWebhookChange(change) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const value = change.value;
            if (!value)
                return;
            const phoneNumberId = (_a = value.metadata) === null || _a === void 0 ? void 0 : _a.phone_number_id;
            const displayPhoneNumber = (_b = value.metadata) === null || _b === void 0 ? void 0 : _b.display_phone_number;
            if (!phoneNumberId)
                return;
            // Находим или создаём организационный телефон по WABA phoneNumberId
            let orgPhone = yield authStorage_1.prisma.organizationPhone.findFirst({
                where: {
                    wabaPhoneNumberId: phoneNumberId,
                    connectionType: 'waba',
                },
            });
            if (!orgPhone) {
                logger.info(`🆕 WABA: Auto-creating OrganizationPhone for phoneNumberId: ${phoneNumberId}`);
                // Получаем первую организацию или создаём дефолтную
                let organization = yield authStorage_1.prisma.organization.findFirst();
                if (!organization) {
                    logger.info('🆕 WABA: Creating default organization');
                    organization = yield authStorage_1.prisma.organization.create({
                        data: {
                            name: 'Default Organization',
                        },
                    });
                }
                // Создаём новый OrganizationPhone с данными из webhook
                orgPhone = yield authStorage_1.prisma.organizationPhone.create({
                    data: {
                        organizationId: organization.id,
                        displayName: `WABA ${displayPhoneNumber || phoneNumberId}`,
                        phoneJid: `${(displayPhoneNumber === null || displayPhoneNumber === void 0 ? void 0 : displayPhoneNumber.replace(/^\+/, '')) || phoneNumberId}@s.whatsapp.net`,
                        status: 'connected',
                        connectionType: 'waba',
                        wabaPhoneNumberId: phoneNumberId,
                        wabaAccessToken: process.env.WABA_ACCESS_TOKEN || null,
                        wabaId: process.env.WABA_ID || null,
                        wabaApiVersion: 'v21.0',
                        wabaVerifyToken: process.env.WABA_VERIFY_TOKEN || null,
                        lastConnectedAt: new Date(),
                    },
                });
                logger.info(`✅ WABA: Created OrganizationPhone id=${orgPhone.id} for ${displayPhoneNumber}`);
            }
            // Обработка статусов сообщений
            if (value.statuses) {
                for (const status of value.statuses) {
                    yield handleMessageStatus(orgPhone.id, status);
                }
            }
            // Обработка входящих сообщений
            if (value.messages) {
                const contacts = value.contacts || [];
                for (const message of value.messages) {
                    // Находим контакт отправителя
                    const contact = contacts.find((c) => c.wa_id === message.from);
                    yield handleIncomingMessage(orgPhone, message, contact);
                }
            }
        }
        catch (error) {
            logger.error('❌ WABA: Change processing error:', error);
        }
    });
}
/**
 * Обработка статуса сообщения (delivered, read, etc.)
 */
function handleMessageStatus(organizationPhoneId, status) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const wabaMessageId = status.id;
            const newStatus = status.status; // sent, delivered, read, failed
            yield authStorage_1.prisma.message.updateMany({
                where: {
                    whatsappMessageId: wabaMessageId,
                    organizationPhoneId,
                },
                data: {
                    status: newStatus,
                },
            });
            logger.info(`📊 WABA: Message ${wabaMessageId} status updated to ${newStatus}`);
        }
        catch (error) {
            logger.error('❌ WABA: Status update error:', error);
        }
    });
}
/**
 * Обработка входящего сообщения
 */
function handleIncomingMessage(orgPhone, message, contact) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s;
        try {
            // Нормализуем номер в формат WhatsApp JID
            const phoneNumber = message.from;
            const remoteJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
            const wabaMessageId = message.id;
            const timestamp = new Date(parseInt(message.timestamp) * 1000);
            // Извлекаем имя из контакта
            const contactName = ((_a = contact === null || contact === void 0 ? void 0 : contact.profile) === null || _a === void 0 ? void 0 : _a.name) || undefined;
            // Определяем тип сообщения и контент
            let content = '';
            let messageType = 'text';
            let mediaUrl;
            let filename;
            let mimeType;
            if (message.type === 'text') {
                content = ((_b = message.text) === null || _b === void 0 ? void 0 : _b.body) || '';
                messageType = 'text';
            }
            else if (message.type === 'image') {
                content = ((_c = message.image) === null || _c === void 0 ? void 0 : _c.caption) || '';
                messageType = 'image';
                mimeType = (_d = message.image) === null || _d === void 0 ? void 0 : _d.mime_type;
                // Скачиваем изображение с серверов WhatsApp и загружаем на R2
                if ((_e = message.image) === null || _e === void 0 ? void 0 : _e.id) {
                    const wabaService = yield (0, wabaService_1.createWABAService)(orgPhone.id);
                    if (wabaService) {
                        try {
                            mediaUrl = yield wabaService.downloadAndUploadMedia(message.image.id, mimeType);
                            logger.info(`✅ WABA: Изображение загружено на R2: ${mediaUrl}`);
                        }
                        catch (error) {
                            logger.error('❌ WABA: Ошибка загрузки изображения:', error);
                        }
                    }
                }
            }
            else if (message.type === 'document') {
                content = ((_f = message.document) === null || _f === void 0 ? void 0 : _f.caption) || '';
                messageType = 'document';
                filename = (_g = message.document) === null || _g === void 0 ? void 0 : _g.filename;
                mimeType = (_h = message.document) === null || _h === void 0 ? void 0 : _h.mime_type;
                // Скачиваем документ с серверов WhatsApp и загружаем на R2
                if ((_j = message.document) === null || _j === void 0 ? void 0 : _j.id) {
                    const wabaService = yield (0, wabaService_1.createWABAService)(orgPhone.id);
                    if (wabaService) {
                        try {
                            mediaUrl = yield wabaService.downloadAndUploadMedia(message.document.id, mimeType);
                            logger.info(`✅ WABA: Документ загружен на R2: ${mediaUrl}`);
                        }
                        catch (error) {
                            logger.error('❌ WABA: Ошибка загрузки документа:', error);
                        }
                    }
                }
            }
            else if (message.type === 'audio') {
                messageType = 'audio';
                mimeType = (_k = message.audio) === null || _k === void 0 ? void 0 : _k.mime_type;
                // Скачиваем аудио с серверов WhatsApp и загружаем на R2
                if ((_l = message.audio) === null || _l === void 0 ? void 0 : _l.id) {
                    const wabaService = yield (0, wabaService_1.createWABAService)(orgPhone.id);
                    if (wabaService) {
                        try {
                            mediaUrl = yield wabaService.downloadAndUploadMedia(message.audio.id, mimeType);
                            logger.info(`✅ WABA: Аудио загружено на R2: ${mediaUrl}`);
                        }
                        catch (error) {
                            logger.error('❌ WABA: Ошибка загрузки аудио:', error);
                        }
                    }
                }
            }
            else if (message.type === 'video') {
                content = ((_m = message.video) === null || _m === void 0 ? void 0 : _m.caption) || '';
                messageType = 'video';
                mimeType = (_o = message.video) === null || _o === void 0 ? void 0 : _o.mime_type;
                // Скачиваем видео с серверов WhatsApp и загружаем на R2
                if ((_p = message.video) === null || _p === void 0 ? void 0 : _p.id) {
                    const wabaService = yield (0, wabaService_1.createWABAService)(orgPhone.id);
                    if (wabaService) {
                        try {
                            mediaUrl = yield wabaService.downloadAndUploadMedia(message.video.id, mimeType);
                            logger.info(`✅ WABA: Видео загружено на R2: ${mediaUrl}`);
                        }
                        catch (error) {
                            logger.error('❌ WABA: Ошибка загрузки видео:', error);
                        }
                    }
                }
            }
            else if (message.type === 'button') {
                content = ((_q = message.button) === null || _q === void 0 ? void 0 : _q.text) || '';
                messageType = 'button';
            }
            else if (message.type === 'interactive') {
                if (((_r = message.interactive) === null || _r === void 0 ? void 0 : _r.type) === 'button_reply') {
                    content = message.interactive.button_reply.title;
                    messageType = 'interactive_button';
                }
                else if (((_s = message.interactive) === null || _s === void 0 ? void 0 : _s.type) === 'list_reply') {
                    content = message.interactive.list_reply.title;
                    messageType = 'interactive_list';
                }
            }
            // Логируем входящее сообщение
            logger.info(`📥 WABA: Входящее [${messageType}]: "${content}" от ${remoteJid} (${contactName || 'Unknown'})`);
            // Создаём или находим чат
            const chatId = yield (0, baileys_1.ensureChat)(orgPhone.organizationId, orgPhone.id, orgPhone.phoneJid, remoteJid, contactName);
            // Сохраняем сообщение в БД
            yield authStorage_1.prisma.message.create({
                data: {
                    chatId,
                    organizationPhoneId: orgPhone.id,
                    organizationId: orgPhone.organizationId,
                    channel: 'whatsapp',
                    whatsappMessageId: wabaMessageId,
                    receivingPhoneJid: orgPhone.phoneJid,
                    remoteJid,
                    senderJid: remoteJid,
                    fromMe: false,
                    content,
                    type: messageType,
                    mediaUrl,
                    filename,
                    mimeType,
                    timestamp,
                    status: 'received',
                    isReadByOperator: false,
                },
            });
            // Увеличиваем счётчик непрочитанных
            yield authStorage_1.prisma.chat.update({
                where: { id: chatId },
                data: {
                    unreadCount: { increment: 1 },
                    lastMessageAt: timestamp,
                },
            });
            logger.info(`💾 WABA: Message saved to DB (chatId: ${chatId})`);
        }
        catch (error) {
            logger.error('❌ WABA: Incoming message processing error:', error);
        }
    });
}
/**
 * Отправка сообщения через WABA
 * POST /api/waba/send
 */
const sendMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m;
    try {
        const { organizationPhoneId, to, message, type = 'text' } = req.body;
        if (!organizationPhoneId || !to || !message) {
            return res.status(400).json({ error: 'Missing required fields' });
        }
        // Проверяем права доступа
        const orgPhone = yield authStorage_1.prisma.organizationPhone.findFirst({
            where: {
                id: organizationPhoneId,
                organizationId: res.locals.organizationId,
                connectionType: 'waba',
            },
        });
        if (!orgPhone) {
            return res.status(404).json({ error: 'Organization phone not found or not configured for WABA' });
        }
        const wabaService = yield (0, wabaService_1.createWABAService)(organizationPhoneId);
        if (!wabaService) {
            return res.status(500).json({
                error: 'WABA service not configured',
                details: 'wabaAccessToken is missing in database. Please update OrganizationPhone with your permanent System User Access Token from Meta.',
                organizationPhoneId: organizationPhoneId
            });
        }
        // Отправляем сообщение
        let result;
        let messageContent = '';
        let mediaUrl = null;
        switch (type) {
            case 'text':
                result = yield wabaService.sendTextMessage(to, message);
                messageContent = message;
                break;
            case 'image':
                if (!message.link) {
                    return res.status(400).json({ error: 'image.link is required' });
                }
                result = yield wabaService.sendImage(to, message.link, message.caption);
                messageContent = message.caption || '';
                mediaUrl = message.link;
                break;
            case 'document':
                if (!message.link) {
                    return res.status(400).json({ error: 'document.link is required' });
                }
                result = yield wabaService.sendDocument(to, message.link, message.filename, message.caption);
                messageContent = message.caption || message.filename || '';
                mediaUrl = message.link;
                break;
            case 'video':
                if (!message.link) {
                    return res.status(400).json({ error: 'video.link is required' });
                }
                result = yield wabaService.sendMessage({
                    to,
                    type: 'video',
                    video: {
                        link: message.link,
                        caption: message.caption,
                    },
                });
                messageContent = message.caption || '';
                mediaUrl = message.link;
                break;
            case 'audio':
                if (!message.link) {
                    return res.status(400).json({ error: 'audio.link is required' });
                }
                result = yield wabaService.sendMessage({
                    to,
                    type: 'audio',
                    audio: {
                        link: message.link,
                    },
                });
                messageContent = 'Audio message';
                mediaUrl = message.link;
                break;
            case 'interactive':
                result = yield wabaService.sendMessage({
                    to,
                    type: 'interactive',
                    interactive: message,
                });
                messageContent = ((_a = message.body) === null || _a === void 0 ? void 0 : _a.text) || JSON.stringify(message);
                break;
            case 'template':
                result = yield wabaService.sendTemplateMessage(to, message.name, message.language, message.components);
                messageContent = `Template: ${message.name}`;
                break;
            default:
                return res.status(400).json({ error: `Unsupported message type: ${type}. Supported: text, image, document, video, audio, interactive, template` });
        }
        // Нормализуем номер получателя в формат WhatsApp JID
        const remoteJid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
        // Сохраняем отправленное сообщение в БД
        const chatId = yield (0, baileys_1.ensureChat)(orgPhone.organizationId, orgPhone.id, orgPhone.phoneJid, remoteJid, undefined);
        yield authStorage_1.prisma.message.create({
            data: {
                chatId,
                organizationPhoneId,
                organizationId: orgPhone.organizationId,
                channel: 'whatsapp',
                whatsappMessageId: (_c = (_b = result.messages) === null || _b === void 0 ? void 0 : _b[0]) === null || _c === void 0 ? void 0 : _c.id,
                receivingPhoneJid: orgPhone.phoneJid,
                remoteJid: remoteJid,
                senderJid: orgPhone.phoneJid,
                fromMe: true,
                content: messageContent,
                mediaUrl: mediaUrl,
                type,
                timestamp: new Date(),
                status: 'sent',
                senderUserId: res.locals.userId,
                isReadByOperator: true,
            },
        });
        res.json({ success: true, messageId: (_e = (_d = result.messages) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.id, data: result });
    }
    catch (error) {
        logger.error('❌ WABA: Send message error:', error);
        // Более детальная информация об ошибке
        const errorMessage = ((_h = (_g = (_f = error.response) === null || _f === void 0 ? void 0 : _f.data) === null || _g === void 0 ? void 0 : _g.error) === null || _h === void 0 ? void 0 : _h.message) || error.message;
        const errorDetails = ((_j = error.response) === null || _j === void 0 ? void 0 : _j.data) || {};
        res.status(500).json({
            error: errorMessage,
            details: errorDetails,
            type: (_m = (_l = (_k = error.response) === null || _k === void 0 ? void 0 : _k.data) === null || _l === void 0 ? void 0 : _l.error) === null || _m === void 0 ? void 0 : _m.type
        });
    }
});
exports.sendMessage = sendMessage;
/**
 * Отправка сообщения оператором (упрощённый API)
 * POST /api/waba/operator/send
 */
const operatorSendMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d;
    try {
        const { chatId, message, type = 'text', mediaUrl, caption, filename, template } = req.body;
        if (!chatId || !message) {
            return res.status(400).json({ error: 'chatId and message are required' });
        }
        // Получаем чат с проверкой доступа
        const chat = yield authStorage_1.prisma.chat.findFirst({
            where: {
                id: chatId,
                organizationId: res.locals.organizationId,
            },
            include: {
                organizationPhone: true,
            },
        });
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' });
        }
        if (chat.organizationPhone.connectionType !== 'waba') {
            return res.status(400).json({ error: 'This chat is not using WABA' });
        }
        const wabaService = yield (0, wabaService_1.createWABAService)(chat.organizationPhoneId);
        if (!wabaService) {
            return res.status(500).json({
                error: 'WABA service not configured',
                details: 'wabaAccessToken is missing'
            });
        }
        // Отправляем сообщение в зависимости от типа
        let result;
        let messageContent = '';
        const recipientPhone = chat.remoteJid.replace('@s.whatsapp.net', '');
        switch (type) {
            case 'text':
                result = yield wabaService.sendTextMessage(recipientPhone, message);
                messageContent = message;
                break;
            case 'image':
                if (!mediaUrl) {
                    return res.status(400).json({ error: 'mediaUrl is required for image type' });
                }
                result = yield wabaService.sendImage(recipientPhone, mediaUrl, caption);
                messageContent = caption || '[Image]';
                break;
            case 'document':
                if (!mediaUrl) {
                    return res.status(400).json({ error: 'mediaUrl is required for document type' });
                }
                result = yield wabaService.sendDocument(recipientPhone, mediaUrl, filename, caption);
                messageContent = caption || `[Document: ${filename || 'file'}]`;
                break;
            case 'template':
                if (!template || !template.name) {
                    return res.status(400).json({ error: 'template object with name is required for template type' });
                }
                result = yield wabaService.sendTemplateMessage(recipientPhone, template.name, template.language || 'ru', template.components);
                messageContent = `Template: ${template.name}`;
                break;
            default:
                return res.status(400).json({ error: 'Unsupported message type. Use: text, image, document, template' });
        }
        // Сохраняем в БД
        const savedMessage = yield authStorage_1.prisma.message.create({
            data: {
                chatId: chat.id,
                organizationPhoneId: chat.organizationPhoneId,
                organizationId: chat.organizationId,
                channel: 'whatsapp',
                whatsappMessageId: (_b = (_a = result.messages) === null || _a === void 0 ? void 0 : _a[0]) === null || _b === void 0 ? void 0 : _b.id,
                receivingPhoneJid: chat.organizationPhone.phoneJid,
                remoteJid: chat.remoteJid,
                senderJid: chat.organizationPhone.phoneJid,
                fromMe: true,
                content: messageContent,
                mediaUrl: mediaUrl || null,
                type: type,
                timestamp: new Date(),
                status: 'sent',
                senderUserId: res.locals.userId,
                isReadByOperator: true,
            },
        });
        // Обновляем lastMessageAt в чате
        yield authStorage_1.prisma.chat.update({
            where: { id: chat.id },
            data: { lastMessageAt: new Date() },
        });
        logger.info(`📤 WABA Operator: Message sent by user ${res.locals.userId} to chat ${chatId}`);
        res.json({
            success: true,
            messageId: (_d = (_c = result.messages) === null || _c === void 0 ? void 0 : _c[0]) === null || _d === void 0 ? void 0 : _d.id,
            message: savedMessage
        });
    }
    catch (error) {
        logger.error('❌ WABA Operator: Send message error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.operatorSendMessage = operatorSendMessage;
/**
 * Получение статуса доставки сообщения
 * GET /api/waba/operator/message-status/:messageId
 */
const getMessageStatus = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { messageId } = req.params;
        const message = yield authStorage_1.prisma.message.findFirst({
            where: {
                id: parseInt(messageId),
                organizationId: res.locals.organizationId,
            },
            select: {
                id: true,
                whatsappMessageId: true,
                status: true,
                timestamp: true,
                content: true,
                fromMe: true,
                chat: {
                    select: {
                        id: true,
                        remoteJid: true,
                    },
                },
            },
        });
        if (!message) {
            return res.status(404).json({ error: 'Message not found' });
        }
        res.json({
            id: message.id,
            whatsappMessageId: message.whatsappMessageId,
            status: message.status,
            timestamp: message.timestamp,
            delivered: ['delivered', 'read'].includes(message.status || ''),
            read: message.status === 'read',
        });
    }
    catch (error) {
        logger.error('❌ WABA: Get message status error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.getMessageStatus = getMessageStatus;
/**
 * Получение истории сообщений чата с WABA статусами
 * GET /api/waba/operator/chat/:chatId/messages
 */
const getChatMessages = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { chatId } = req.params;
        const { limit = '50', offset = '0' } = req.query;
        const chat = yield authStorage_1.prisma.chat.findFirst({
            where: {
                id: parseInt(chatId),
                organizationId: res.locals.organizationId,
            },
        });
        if (!chat) {
            return res.status(404).json({ error: 'Chat not found' });
        }
        const messages = yield authStorage_1.prisma.message.findMany({
            where: { chatId: chat.id },
            orderBy: { timestamp: 'desc' },
            take: parseInt(limit),
            skip: parseInt(offset),
            select: {
                id: true,
                whatsappMessageId: true,
                content: true,
                mediaUrl: true,
                type: true,
                fromMe: true,
                timestamp: true,
                status: true,
                isReadByOperator: true,
                senderUser: {
                    select: {
                        id: true,
                        email: true,
                    },
                },
            },
        });
        const total = yield authStorage_1.prisma.message.count({
            where: { chatId: chat.id },
        });
        res.json({
            messages: messages.map(msg => (Object.assign(Object.assign({}, msg), { delivered: ['delivered', 'read'].includes(msg.status || ''), read: msg.status === 'read' }))),
            total,
            limit: parseInt(limit),
            offset: parseInt(offset),
        });
    }
    catch (error) {
        logger.error('❌ WABA: Get chat messages error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.getChatMessages = getChatMessages;
/**
 * Получение шаблонов сообщений
 * GET /api/waba/templates
 */
const getTemplates = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const { organizationPhoneId } = req.query;
        if (!organizationPhoneId) {
            return res.status(400).json({ error: 'organizationPhoneId is required' });
        }
        const wabaService = yield (0, wabaService_1.createWABAService)(Number(organizationPhoneId));
        if (!wabaService) {
            return res.status(500).json({ error: 'WABA service not configured' });
        }
        // Здесь можно добавить получение шаблонов через Graph API
        // const templates = await wabaService.getTemplates();
        res.json({ templates: [] });
    }
    catch (error) {
        logger.error('❌ WABA: Get templates error:', error);
        res.status(500).json({ error: error.message });
    }
});
exports.getTemplates = getTemplates;
//# sourceMappingURL=wabaController.js.map