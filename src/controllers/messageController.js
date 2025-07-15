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
exports.sendTextMessage = void 0;
const baileys_1 = require("../config/baileys");
const baileys_2 = require("@whiskeysockets/baileys");
const pino_1 = __importDefault(require("pino"));
const authStorage_1 = require("../config/authStorage"); // Для получения phoneJid
const logger = (0, pino_1.default)({ level: 'info' });
const sendTextMessage = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { organizationPhoneId, receiverJid, text } = req.body;
    const organizationId = res.locals.organizationId;
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
        const sentMessage = yield (0, baileys_1.sendMessage)(sock, normalizedReceiverJid, { text }, organizationId, // Передаем organizationId
        organizationPhoneId, // Передаем organizationPhoneId
        senderJid // Передаем JID вашего номера
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
