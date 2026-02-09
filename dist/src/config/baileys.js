"use strict";
// src/config/baileys.ts
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
var __asyncValues = (this && this.__asyncValues) || function (o) {
    if (!Symbol.asyncIterator) throw new TypeError("Symbol.asyncIterator is not defined.");
    var m = o[Symbol.asyncIterator], i;
    return m ? m.call(o) : (o = typeof __values === "function" ? __values(o) : o[Symbol.iterator](), i = {}, verb("next"), verb("throw"), verb("return"), i[Symbol.asyncIterator] = function () { return this; }, i);
    function verb(n) { i[n] = o[n] && function (v) { return new Promise(function (resolve, reject) { v = o[n](v), settle(resolve, reject, v.done, v.value); }); }; }
    function settle(resolve, reject, d, v) { Promise.resolve(v).then(function(v) { resolve({ value: v, done: d }); }, reject); }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureChat = ensureChat;
exports.useDBAuthState = useDBAuthState;
exports.startBaileys = startBaileys;
exports.getBaileysSock = getBaileysSock;
exports.getSessionErrorStats = getSessionErrorStats;
exports.forceCloseSession = forceCloseSession;
exports.sendMessage = sendMessage;
const baileys_1 = __importStar(require("@whiskeysockets/baileys"));
const authStorage_1 = require("./authStorage");
const qrcode_terminal_1 = __importDefault(require("qrcode-terminal"));
const pino_1 = __importDefault(require("pino"));
const buffer_1 = require("buffer");
const path_1 = __importDefault(require("path")); // Для работы с путями файлов
const socketService_1 = require("../services/socketService"); // Socket.IO
const logger = (0, pino_1.default)({ level: 'info' });
function envInt(name, fallback) {
    const raw = process.env[name];
    if (!raw)
        return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}
// Таймауты по умолчанию можно переопределить через env,
// чтобы избежать падений на медленных/нестабильных сетях (Timed Out в Baileys query).
const BAILEYS_CONNECT_TIMEOUT_MS = envInt('BAILEYS_CONNECT_TIMEOUT_MS', 60000);
const BAILEYS_DEFAULT_QUERY_TIMEOUT_MS = envInt('BAILEYS_DEFAULT_QUERY_TIMEOUT_MS', 60000);
const BAILEYS_KEEP_ALIVE_INTERVAL_MS = envInt('BAILEYS_KEEP_ALIVE_INTERVAL_MS', 25000);
function safeAsyncListener(eventName, handler) {
    return (...args) => {
        Promise.resolve(handler(...args)).catch((err) => {
            logger.error({ err }, `[Baileys] Unhandled error in listener: ${eventName}`);
        });
    };
}
// Глобальная Map для хранения активных экземпляров WASocket по organizationPhoneId
const socks = new Map();
// Map для отслеживания ошибок Bad MAC по organizationPhoneId
const badMacErrorCount = new Map();
const MAX_BAD_MAC_ERRORS = 3; // Максимум ошибок перед сбросом сессии
// Map для отслеживания ошибок Bad Decrypt по organizationPhoneId
const badDecryptErrorCount = new Map();
const MAX_BAD_DECRYPT_ERRORS = 5; // Максимум ошибок перед сбросом сессии (больше чем MAC, т.к. менее критично)
// --- НОВАЯ ВСПОМОГАТЕЛЬНАЯ ФУНКЦИЯ ---
/**
 * Скачивает медиа из сообщения и сохраняет его в хранилище (R2/S3/Local).
 * @param messageContent Содержимое сообщения (например, imageMessage).
 * @param type Тип медиа ('image', 'video', 'audio', 'document').
 * @param originalFilename Имя файла (для документов).
 * @returns URL к сохраненному файлу.
 */
function downloadAndSaveMedia(messageContent, type, originalFilename) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, e_1, _b, _c;
        var _d;
        try {
            const stream = yield (0, baileys_1.downloadContentFromMessage)(messageContent, type);
            let buffer = buffer_1.Buffer.from([]);
            try {
                for (var _e = true, stream_1 = __asyncValues(stream), stream_1_1; stream_1_1 = yield stream_1.next(), _a = stream_1_1.done, !_a; _e = true) {
                    _c = stream_1_1.value;
                    _e = false;
                    const chunk = _c;
                    buffer = buffer_1.Buffer.concat([buffer, chunk]);
                }
            }
            catch (e_1_1) { e_1 = { error: e_1_1 }; }
            finally {
                try {
                    if (!_e && !_a && (_b = stream_1.return)) yield _b.call(stream_1);
                }
                finally { if (e_1) throw e_1.error; }
            }
            const extension = path_1.default.extname(originalFilename || '') || `.${((_d = messageContent.mimetype) === null || _d === void 0 ? void 0 : _d.split('/')[1]) || 'bin'}`;
            const mimetype = messageContent.mimetype || 'application/octet-stream';
            const filename = originalFilename || `file-${Date.now()}${extension}`;
            // Используем универсальный storage service
            const { saveMedia } = yield Promise.resolve().then(() => __importStar(require('../services/storageService')));
            const mediaUrl = yield saveMedia(buffer, filename, mimetype);
            // logger.info(`✅ Медиафайл сохранен: ${mediaUrl}`);
            return mediaUrl;
        }
        catch (error) {
            logger.error('❌ Ошибка при скачивании или сохранении медиа:', error);
            return undefined;
        }
    });
}
/**
 * Корректно закрывает сессию Baileys и очищает ресурсы.
 * @param organizationPhoneId ID телефона организации
 * @param phoneJid JID номера телефона
 * @param reason Причина закрытия
 */
function closeSession(organizationPhoneId, phoneJid, reason) {
    return __awaiter(this, void 0, void 0, function* () {
        const key = phoneJid.split('@')[0].split(':')[0];
        // logger.warn(`🚪 Закрытие сессии для ${phoneJid}. Причина: ${reason}`);
        try {
            // Получаем сокет
            const sock = socks.get(organizationPhoneId);
            if (sock) {
                // Пытаемся корректно закрыть WebSocket соединение
                try {
                    if (sock.ws.readyState === 1) { // OPEN
                        yield sock.end(new Error(reason));
                        // logger.info(`✅ WebSocket соединение закрыто для ${phoneJid}`);
                    }
                    else {
                        // logger.info(`ℹ️ WebSocket уже закрыт (state: ${(sock.ws as any).readyState})`);
                    }
                }
                catch (wsError) {
                    // logger.error(`⚠️ Ошибка при закрытии WebSocket:`, wsError);
                    // Продолжаем даже если WebSocket не закрылся корректно
                }
                // Удаляем сокет из Map
                socks.delete(organizationPhoneId);
                // logger.info(`✅ Сокет удален из Map для organizationPhoneId: ${organizationPhoneId}`);
            }
            else {
                // logger.info(`ℹ️ Сокет не найден в Map для organizationPhoneId: ${organizationPhoneId}`);
            }
            // Очищаем счетчик ошибок
            badMacErrorCount.delete(organizationPhoneId);
        }
        catch (error) {
            // logger.error(`❌ Ошибка при закрытии сессии для ${phoneJid}:`, error);
            // Принудительно удаляем из Map даже при ошибке
            socks.delete(organizationPhoneId);
            badMacErrorCount.delete(organizationPhoneId);
        }
    });
}
/**
 * Обработчик ошибок Bad Decrypt из app state sync.
 * Очищает поврежденные данные синхронизации app state.
 * @param organizationId ID организации
 * @param organizationPhoneId ID телефона организации
 * @param phoneJid JID номера телефона
 * @returns true если данные были очищены, false если достигнут лимит ошибок и сессия закрыта
 */
function handleBadDecryptError(organizationId, organizationPhoneId, phoneJid) {
    return __awaiter(this, void 0, void 0, function* () {
        const key = phoneJid.split('@')[0].split(':')[0];
        // Увеличиваем счетчик ошибок
        const currentCount = badDecryptErrorCount.get(organizationPhoneId) || 0;
        badDecryptErrorCount.set(organizationPhoneId, currentCount + 1);
        // logger.warn(`⚠️ Bad Decrypt error #${currentCount + 1} для ${phoneJid}`);
        if (currentCount + 1 >= MAX_BAD_DECRYPT_ERRORS) {
            // logger.error(`❌ Достигнут лимит Bad Decrypt ошибок (${MAX_BAD_DECRYPT_ERRORS}) для ${phoneJid}. Полный выход из сессии.`);
            try {
                // 1. Корректно закрываем сессию
                yield closeSession(organizationPhoneId, phoneJid, `Bad Decrypt error limit reached (${MAX_BAD_DECRYPT_ERRORS} errors)`);
                // 2. Удаляем ВСЕ данные авторизации из БД
                const deletedCount = yield authStorage_1.prisma.baileysAuth.deleteMany({
                    where: {
                        organizationId: organizationId,
                        phoneJid: key,
                    }
                });
                // logger.info(`🗑️ Удалено ${deletedCount.count} записей авторизации для ${key}`);
                // 3. Обновляем статус телефона на 'logged_out'
                yield authStorage_1.prisma.organizationPhone.update({
                    where: { id: organizationPhoneId },
                    data: {
                        status: 'logged_out',
                        qrCode: null,
                        lastConnectedAt: new Date(),
                    },
                });
                // logger.info(`📱 Статус телефона ${key} обновлен на 'logged_out'`);
                // logger.info(`✅ Сессия для ${phoneJid} полностью завершена из-за повторяющихся Bad Decrypt ошибок. Требуется повторное QR-сканирование.`);
                return false;
            }
            catch (e) {
                logger.error(`❌ Ошибка при полном выходе из сессии:`, e);
                // Даже при ошибке пытаемся закрыть сокет
                yield closeSession(organizationPhoneId, phoneJid, 'Error during Bad Decrypt cleanup');
                return false;
            }
        }
        // Очищаем только поврежденные ключи app state (без полного выхода)
        try {
            const deletedCount = yield authStorage_1.prisma.baileysAuth.deleteMany({
                where: {
                    organizationId: organizationId,
                    phoneJid: key,
                    key: {
                        startsWith: 'app-state-sync-'
                    }
                }
            });
            // logger.info(`✅ Удалено ${deletedCount.count} поврежденных ключей app state для ${key}. Соединение продолжит работу.`);
            return true;
        }
        catch (e) {
            logger.error(`❌ Ошибка при удалении поврежденных данных app state:`, e);
            return false;
        }
    });
}
/**
 * Обработчик ошибок Bad MAC из libsignal.
 * Очищает поврежденные сессии Signal Protocol для указанного номера.
 * @param organizationId ID организации
 * @param organizationPhoneId ID телефона организации
 * @param phoneJid JID номера телефона
 * @returns true если сессия была очищена, false если достигнут лимит ошибок и сессия закрыта
 */
function handleBadMacError(organizationId, organizationPhoneId, phoneJid) {
    return __awaiter(this, void 0, void 0, function* () {
        const key = phoneJid.split('@')[0].split(':')[0];
        // Увеличиваем счетчик ошибок
        const currentCount = badMacErrorCount.get(organizationPhoneId) || 0;
        badMacErrorCount.set(organizationPhoneId, currentCount + 1);
        // logger.warn(`⚠️ Bad MAC error #${currentCount + 1} для ${phoneJid}`);
        if (currentCount + 1 >= MAX_BAD_MAC_ERRORS) {
            // logger.error(`❌ Достигнут лимит Bad MAC ошибок (${MAX_BAD_MAC_ERRORS}) для ${phoneJid}. Полный выход из сессии.`);
            try {
                // 1. Корректно закрываем сессию
                yield closeSession(organizationPhoneId, phoneJid, `Bad MAC error limit reached (${MAX_BAD_MAC_ERRORS} errors)`);
                // 2. Удаляем ВСЕ данные авторизации из БД
                const deletedCount = yield authStorage_1.prisma.baileysAuth.deleteMany({
                    where: {
                        organizationId: organizationId,
                        phoneJid: key,
                    }
                });
                // logger.info(`🗑️ Удалено ${deletedCount.count} записей авторизации для ${key}`);
                // 3. Обновляем статус телефона на 'logged_out'
                yield authStorage_1.prisma.organizationPhone.update({
                    where: { id: organizationPhoneId },
                    data: {
                        status: 'logged_out',
                        qrCode: null,
                        lastConnectedAt: new Date(),
                    },
                });
                // logger.info(`📱 Статус телефона ${key} обновлен на 'logged_out'`);
                // logger.info(`✅ Сессия для ${phoneJid} полностью завершена. Требуется повторное QR-сканирование.`);
                return false;
            }
            catch (e) {
                logger.error(`❌ Ошибка при полном выходе из сессии:`, e);
                // Даже при ошибке пытаемся закрыть сокет
                yield closeSession(organizationPhoneId, phoneJid, 'Error during session cleanup');
                return false;
            }
        }
        // Очищаем только поврежденные ключи сессий (без полного выхода)
        try {
            const deletedCount = yield authStorage_1.prisma.baileysAuth.deleteMany({
                where: {
                    organizationId: organizationId,
                    phoneJid: key,
                    OR: [
                        { key: { startsWith: 'session-' } },
                        { key: { startsWith: 'pre-key-' } },
                        { key: { startsWith: 'sender-key-' } }
                    ]
                }
            });
            // logger.info(`✅ Удалено ${deletedCount.count} поврежденных ключей сессий для ${key}. Попытка восстановления...`);
            return true;
        }
        catch (e) {
            logger.error(`❌ Ошибка при удалении поврежденных сессий:`, e);
            return false;
        }
    });
}
/**
 * Вспомогательная функция для поиска или создания записи чата в БД.
 * Используется для получения chatId для Message.
 * @param organizationId ID организации
 * @param organizationPhoneId ID телефона организации, через который идет этот чат
 * @param receivingPhoneJid Ваш номер телефона (JID), который участвует в чате
 * @param remoteJid Идентификатор JID удаленного собеседника
 * @param name Необязательное имя чата
 * @returns ID чата из вашей БД.
 */
function ensureChat(organizationId, organizationPhoneId, receivingPhoneJid, remoteJid, name) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        try {
            const normalizedRemoteJid = (0, baileys_1.jidNormalizedUser)(remoteJid);
            // 1) Вычисляем канонический myJid (receivingPhoneJid) с учетом всех доступных источников
            let myJidNormalized;
            const candidates = [
                receivingPhoneJid,
                // JID текущего активного сокета для этого organizationPhoneId, если есть
                (_b = (_a = socks.get(organizationPhoneId)) === null || _a === void 0 ? void 0 : _a.user) === null || _b === void 0 ? void 0 : _b.id,
            ];
            // Пробуем добрать JID из OrganizationPhone
            try {
                const orgPhone = yield authStorage_1.prisma.organizationPhone.findUnique({
                    where: { id: organizationPhoneId },
                    select: { phoneJid: true },
                });
                if (orgPhone === null || orgPhone === void 0 ? void 0 : orgPhone.phoneJid) {
                    candidates.push(orgPhone.phoneJid);
                }
            }
            catch (e) {
                logger.warn(`[ensureChat] Не удалось получить OrganizationPhone(${organizationPhoneId}) для нормализации JID: ${String(e)}`);
            }
            for (const c of candidates) {
                if (c && typeof c === 'string' && c.trim()) {
                    const norm = (0, baileys_1.jidNormalizedUser)(c);
                    if (norm) {
                        myJidNormalized = norm;
                        break;
                    }
                }
            }
            if (!myJidNormalized) {
                // В крайнем случае используем исходное значение, даже если оно пустое — но лучше залогируем
                logger.warn(`[ensureChat] receivingPhoneJid не удалось нормализовать. Поступившее значение: "${receivingPhoneJid}". Будет использовано пустое значение, что может привести к дублям.`);
                myJidNormalized = ''; // осознанно допускаем пустую строку, ниже попытаемся слить её при первой возможности
            }
            // 2) Пытаемся найти чат по уникальному ключу (если JID известен)
            let chat = myJidNormalized
                ? yield authStorage_1.prisma.chat.findFirst({
                    where: {
                        organizationId,
                        channel: 'whatsapp',
                        receivingPhoneJid: myJidNormalized,
                        remoteJid: normalizedRemoteJid,
                    },
                })
                : null;
            // 3) Если не нашли и ранее мог быть создан чат с пустым receivingPhoneJid — попробуем его найти и обновить
            if (!chat) {
                const emptyChat = yield authStorage_1.prisma.chat.findFirst({
                    where: {
                        organizationId,
                        remoteJid: normalizedRemoteJid,
                        receivingPhoneJid: '',
                    },
                });
                if (emptyChat && myJidNormalized) {
                    chat = yield authStorage_1.prisma.chat.update({
                        where: { id: emptyChat.id },
                        data: {
                            receivingPhoneJid: myJidNormalized,
                            organizationPhoneId,
                            lastMessageAt: new Date(),
                        },
                    });
                    // logger.info(`🔄 Обновлён чат #${chat.id}: установлен receivingPhoneJid=${myJidNormalized} вместо пустого (remoteJid=${normalizedRemoteJid}).`);
                }
            }
            // 4) Если по-прежнему не нашли — создаём новый
            if (!chat) {
                try {
                    // Генерируем следующий номер тикета для организации
                    const lastTicket = yield authStorage_1.prisma.chat.findFirst({
                        where: {
                            organizationId,
                            ticketNumber: { not: null }
                        },
                        orderBy: { ticketNumber: 'desc' },
                        select: { ticketNumber: true },
                    });
                    const nextTicketNumber = ((lastTicket === null || lastTicket === void 0 ? void 0 : lastTicket.ticketNumber) || 0) + 1;
                    chat = yield authStorage_1.prisma.chat.create({
                        data: {
                            organizationId,
                            receivingPhoneJid: myJidNormalized,
                            remoteJid: normalizedRemoteJid,
                            organizationPhoneId: organizationPhoneId,
                            name: name || normalizedRemoteJid.split('@')[0],
                            isGroup: (0, baileys_1.isJidGroup)(normalizedRemoteJid),
                            lastMessageAt: new Date(),
                            // Тикет-система: автоматически создаем тикет для нового чата
                            ticketNumber: nextTicketNumber,
                            status: 'new',
                            priority: 'medium',
                        },
                    });
                    // logger.info(`✅ Создан новый чат для JID: ${normalizedRemoteJid} (Ваш номер: ${myJidNormalized || '(пусто)'}, Организация: ${organizationId}, Phone ID: ${organizationPhoneId}, ID чата: ${chat.id}, Тикет #${nextTicketNumber})`);
                    // Отправляем Socket.IO уведомление о новом чате
                    try {
                        (0, socketService_1.notifyNewChat)(organizationId, {
                            id: chat.id,
                            remoteJid: chat.remoteJid,
                            name: chat.name,
                            channel: 'whatsapp',
                            ticketNumber: chat.ticketNumber,
                            status: chat.status,
                            priority: chat.priority,
                            lastMessageAt: chat.lastMessageAt,
                            unreadCount: 0,
                        });
                    }
                    catch (socketError) {
                        logger.error('[Socket.IO] Ошибка отправки уведомления о новом чате:', socketError);
                    }
                }
                catch (e) {
                    // Возможна гонка и уникальный конфликт — пробуем перечитать
                    if ((e === null || e === void 0 ? void 0 : e.code) === 'P2002') {
                        const existing = yield authStorage_1.prisma.chat.findFirst({
                            where: {
                                organizationId,
                                channel: 'whatsapp',
                                receivingPhoneJid: myJidNormalized,
                                remoteJid: normalizedRemoteJid,
                            },
                        });
                        if (existing) {
                            chat = existing;
                            // logger.info(`♻️ Найден уже существующий чат после конфликта уникальности: #${chat.id}`);
                        }
                        else {
                            throw e;
                        }
                    }
                    else {
                        throw e;
                    }
                }
            }
            else {
                // 5) Обновим lastMessageAt и при необходимости имя/organizationPhoneId
                const updateData = { lastMessageAt: new Date(), organizationPhoneId };
                if (name && typeof name === 'string' && name.trim() && name !== chat.name) {
                    updateData.name = name.trim();
                }
                // Если чат был закрыт - создаем новый тикет и меняем статус на 'new'
                if (chat.status === 'closed') {
                    // Генерируем следующий номер тикета для организации
                    const lastTicket = yield authStorage_1.prisma.chat.findFirst({
                        where: {
                            organizationId,
                            ticketNumber: { not: null }
                        },
                        orderBy: { ticketNumber: 'desc' },
                        select: { ticketNumber: true },
                    });
                    const nextTicketNumber = ((lastTicket === null || lastTicket === void 0 ? void 0 : lastTicket.ticketNumber) || 0) + 1;
                    updateData.ticketNumber = nextTicketNumber;
                    updateData.status = 'new';
                    updateData.priority = 'medium';
                    updateData.assignedUserId = null; // Сбрасываем назначение
                    updateData.closedAt = null;
                    // logger.info(`🔄 Чат #${chat.id} был закрыт - создан новый тикет #${nextTicketNumber} (статус изменен: closed → new)`);
                }
                yield authStorage_1.prisma.chat.update({
                    where: { id: chat.id },
                    data: updateData,
                });
            }
            return chat.id;
        }
        catch (error) {
            logger.error(`❌ Ошибка в ensureChat для JID ${remoteJid} (Ваш номер: ${receivingPhoneJid}, Phone ID: ${organizationPhoneId}):`, error);
            if (error.stack) {
                logger.error('Stack trace:', error.stack);
            }
            if (error.code && error.meta) {
                logger.error(`Prisma Error Code: ${error.code}, Meta:`, JSON.stringify(error.meta, null, 2));
            }
            throw error;
        }
    });
}
/**
 * Хук для управления состоянием аутентификации Baileys с использованием базы данных.
 * Загружает, сохраняет и управляет учетными данными и ключами сигналов.
 * @param organizationId ID организации.
 * @param phoneJid JID номера телефона.
 * @returns Объект с `state` (для makeWASocket) и `saveCreds` (для обработчика 'creds.update').
 */
function useDBAuthState(organizationId, phoneJid) {
    return __awaiter(this, void 0, void 0, function* () {
        // Извлекаем только номер из полного JID для использования в качестве ключа
        const key = phoneJid.split('@')[0].split(':')[0];
        const authDB = (0, authStorage_1.createAuthDBAdapter)(organizationId, key);
        // 1. Загрузка и инициализация creds
        let creds;
        const storedCredsData = yield authDB.get('creds');
        if (storedCredsData && storedCredsData.type === 'base64_json') {
            try {
                const decodedCredsJsonString = buffer_1.Buffer.from(storedCredsData.value, 'base64').toString('utf8');
                const parsedCreds = JSON.parse(decodedCredsJsonString, baileys_1.BufferJSON.reviver);
                // Проверка на полноту данных
                if (parsedCreds.noiseKey && parsedCreds.signedIdentityKey && parsedCreds.registered !== undefined) {
                    creds = parsedCreds;
                    // logger.info(`✅ Учетные данные (creds) успешно загружены из БД для ${key}.`);
                }
                else {
                    // logger.warn(`⚠️ Загруженные creds неполны для ${key}. Инициализация новых.`);
                    creds = (0, baileys_1.initAuthCreds)();
                }
            }
            catch (e) {
                // logger.error(`⚠️ Ошибка парсинга creds из БД для ${key}. Инициализация новых.`, e);
                creds = (0, baileys_1.initAuthCreds)();
            }
        }
        else {
            creds = (0, baileys_1.initAuthCreds)();
            // logger.info(`creds не найдены в БД для ${key}, инициализация новых.`);
        }
        // 2. Создание хранилища ключей (SignalStore)
        const keys = {
            get(type, ids) {
                return __awaiter(this, void 0, void 0, function* () {
                    const data = {};
                    for (const id of ids.filter(Boolean)) {
                        const dbKey = `${type}-${id}`;
                        const storedData = yield authDB.get(dbKey);
                        if (storedData) {
                            try {
                                if (storedData.type === 'base64_json') {
                                    const decoded = buffer_1.Buffer.from(storedData.value, 'base64').toString('utf8');
                                    data[id] = JSON.parse(decoded, baileys_1.BufferJSON.reviver);
                                }
                                else if (storedData.type === 'buffer') {
                                    data[id] = buffer_1.Buffer.from(storedData.value, 'base64');
                                }
                            }
                            catch (e) {
                                logger.warn(`Ошибка при получении/парсинге ключа ${dbKey}:`, e);
                                delete data[id]; // Удаляем невалидные данные
                            }
                        }
                    }
                    return data;
                });
            },
            set(data) {
                return __awaiter(this, void 0, void 0, function* () {
                    const tasks = [];
                    for (const key in data) {
                        const type = key;
                        const typeData = data[type];
                        if (typeData) {
                            for (const id in typeData) {
                                const value = typeData[id];
                                const dbKey = `${type}-${id}`;
                                if (value) {
                                    let valueToStore;
                                    let dataType;
                                    if (value instanceof buffer_1.Buffer) {
                                        valueToStore = value.toString('base64');
                                        dataType = 'buffer';
                                    }
                                    else {
                                        valueToStore = buffer_1.Buffer.from(JSON.stringify(value, baileys_1.BufferJSON.replacer), 'utf8').toString('base64');
                                        dataType = 'base64_json';
                                    }
                                    tasks.push(authDB.set(dbKey, valueToStore, dataType));
                                }
                                else {
                                    tasks.push(authDB.delete(dbKey));
                                }
                            }
                        }
                    }
                    yield Promise.all(tasks);
                });
            }
        };
        return {
            state: {
                creds,
                keys: (0, baileys_1.makeCacheableSignalKeyStore)(keys, logger),
            },
            saveCreds: () => __awaiter(this, void 0, void 0, function* () {
                // logger.info(`🔐 Сохранение обновленных creds в БД для ${key}.`);
                const base64Creds = buffer_1.Buffer.from(JSON.stringify(creds, baileys_1.BufferJSON.replacer), 'utf8').toString('base64');
                yield authDB.set('creds', base64Creds, 'base64_json');
            }),
        };
    });
}
/**
 * Запускает или перезапускает Baileys сессию для указанного телефона организации.
 * @param organizationId ID организации.
 * @param organizationPhoneId ID телефона организации в вашей БД.
 * @param phoneJid JID номера телефона WhatsApp (например, '77051234567@s.whatsapp.net').
 * @returns Экземпляр WASocket.
 */
function startBaileys(organizationId, organizationPhoneId, phoneJid) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a, _b;
        const { state, saveCreds } = yield useDBAuthState(organizationId, phoneJid);
        // Получаем последнюю версию WhatsApp Web API
        const { version } = yield (0, baileys_1.fetchLatestBaileysVersion)();
        // logger.info(`Используется WhatsApp Web API версии: ${version.join('.')}`);
        // Создаем новый экземпляр Baileys WASocket
        const currentSock = (0, baileys_1.default)({
            version,
            auth: state, // Используем состояние из useDBAuthState
            browser: ['Ubuntu', 'Chrome', '22.04.4'], // Устанавливаем информацию о браузере
            logger: logger, // Используем ваш pino logger
            connectTimeoutMs: BAILEYS_CONNECT_TIMEOUT_MS,
            defaultQueryTimeoutMs: BAILEYS_DEFAULT_QUERY_TIMEOUT_MS,
            keepAliveIntervalMs: BAILEYS_KEEP_ALIVE_INTERVAL_MS,
            // ИСПРАВЛЕНИЕ: Отключаем автоматическую синхронизацию app state для предотвращения ошибок дешифрования
            syncFullHistory: false, // Отключаем полную синхронизацию истории
            shouldSyncHistoryMessage: () => false, // Отключаем синхронизацию сообщений
            // Функция для получения сообщений из кэша или БД (для Baileys)
            getMessage: (key) => __awaiter(this, void 0, void 0, function* () {
                logger.debug(`Попытка получить сообщение из getMessage: ${key.id} от ${key.remoteJid}`);
                const msg = yield authStorage_1.prisma.message.findFirst({
                    where: {
                        channel: 'whatsapp',
                        whatsappMessageId: key.id || '',
                    },
                    select: {
                        content: true,
                        type: true,
                        remoteJid: true,
                        senderJid: true,
                        fromMe: true,
                        timestamp: true,
                        mediaUrl: true,
                        mimeType: true,
                        filename: true,
                        size: true
                    }
                });
                if (msg) {
                    if (msg.type === 'text') {
                        return { conversation: msg.content };
                    }
                    else if (msg.type === 'image' && msg.mediaUrl) {
                        return { imageMessage: { caption: msg.content || '', mimetype: msg.mimeType || 'image/jpeg' } };
                    }
                    return { conversation: msg.content || 'Сообщение найдено в БД, но тип не поддержан для getMessage.' };
                }
                return { conversation: 'Сообщение не найдено в кэше или БД' };
            })
        });
        // !!! КРИТИЧЕСКОЕ ИЗМЕНЕНИЕ: Добавляем созданный сокет в socks Map !!!
        socks.set(organizationPhoneId, currentSock);
        // Обработчик событий обновления соединения
        currentSock.ev.on('connection.update', safeAsyncListener('connection.update(main)', (update) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c;
            const { connection, lastDisconnect, qr } = update;
            // logger.info(`[ConnectionUpdate] Status for ${phoneJid}: connection=${connection}, QR_present=${!!qr}`);
            // if (lastDisconnect) {
            //   logger.info(`[ConnectionUpdate] lastDisconnect for ${phoneJid}: reason=${(lastDisconnect.error as Boom)?.output?.statusCode || lastDisconnect.error?.message || 'Неизвестно'}`);
            // }
            // Если получен QR-код
            if (qr) {
                // logger.info(`[ConnectionUpdate] QR code received for ${phoneJid}. Length: ${qr.length}`);
                // Сохраняем QR-код в БД и обновляем статус
                yield authStorage_1.prisma.organizationPhone.update({
                    where: { id: organizationPhoneId },
                    data: { qrCode: qr, status: 'pending' },
                });
                // Выводим QR-код в терминал
                console.log(`\n======================================================`);
                console.log(`       QR-КОД ДЛЯ НОМЕРА: ${phoneJid}           `);
                console.log(`======================================================`);
                qrcode_terminal_1.default.generate(qr, { small: true });
                console.log(`======================================================`);
                console.log(`  Отсканируйте QR-код с помощью WhatsApp на вашем телефоне.`);
                console.log(`  (WhatsApp -> Настройки -> Связанные устройства -> Привязка устройства)`);
                console.log(`======================================================\n`);
            }
            else {
                // logger.info(`[ConnectionUpdate] No QR code in this update for ${phoneJid}.`);
            }
            // Если соединение закрыто
            if (connection === 'close') {
                const shouldReconnect = ((_b = (_a = lastDisconnect === null || lastDisconnect === void 0 ? void 0 : lastDisconnect.error) === null || _a === void 0 ? void 0 : _a.output) === null || _b === void 0 ? void 0 : _b.statusCode) !== baileys_1.DisconnectReason.loggedOut;
                // logger.info(`[Connection] Соединение закрыто для ${phoneJid}. Причина: ${lastDisconnect?.error}. Переподключение: ${shouldReconnect}`);
                // Удаляем сокет из Map перед попыткой переподключения или завершением
                socks.delete(organizationPhoneId);
                if (shouldReconnect) {
                    // Задержка перед попыткой переподключения
                    yield new Promise(resolve => setTimeout(resolve, 3000));
                    // logger.info(`[Connection] Попытка переподключения для ${phoneJid}...`);
                    // Рекурсивно вызываем startBaileys для создания новой сессии
                    void startBaileys(organizationId, organizationPhoneId, phoneJid).catch((err) => {
                        logger.error({ err }, `[Connection] Ошибка при переподключении Baileys для ${phoneJid}`);
                    });
                }
                else {
                    // logger.error(`[Connection] Подключение для ${phoneJid} не будет переподключено (Logged out). Очистка данных сессии...`);
                    // --- ДОБАВЛЕНО: Детальный лог ошибки ---
                    // logger.error(`[Connection] Детали ошибки 'lastDisconnect' для ${phoneJid}:`, lastDisconnect);
                    // --- ИСПРАВЛЕНО: Используем только номер для ключа, как в useDBAuthState ---
                    const key = phoneJid.split('@')[0].split(':')[0];
                    // Очищаем данные сессии из БД по правильному ключу
                    yield authStorage_1.prisma.baileysAuth.deleteMany({
                        where: {
                            organizationId: organizationId,
                            phoneJid: key, // Используем только номер
                        }
                    });
                    // logger.info(`✅ Данные сессии для ${key} удалены из БД.`);
                    // Обновляем статус в БД на 'logged_out' и очищаем QR-код
                    yield authStorage_1.prisma.organizationPhone.update({
                        where: { id: organizationPhoneId },
                        data: { status: 'logged_out', lastConnectedAt: new Date(), qrCode: null },
                    });
                }
            }
            else if (connection === 'open') {
                // Если соединение открыто
                // logger.info(`✅ Подключено к WhatsApp для ${phoneJid} (Организация: ${organizationId}, Phone ID: ${organizationPhoneId})`);
                // Очищаем счетчики ошибок при успешном подключении
                badMacErrorCount.delete(organizationPhoneId);
                badDecryptErrorCount.delete(organizationPhoneId);
                // logger.info(`🔄 Счетчики ошибок сброшены для organizationPhoneId: ${organizationPhoneId}`);
                // Обновляем статус в БД на 'connected', сохраняем фактический JID и очищаем QR-код
                const actualPhoneJid = ((_c = currentSock === null || currentSock === void 0 ? void 0 : currentSock.user) === null || _c === void 0 ? void 0 : _c.id) || phoneJid;
                // Проверяем, не используется ли этот phoneJid другим телефоном
                const existingPhone = yield authStorage_1.prisma.organizationPhone.findFirst({
                    where: {
                        phoneJid: actualPhoneJid,
                        id: { not: organizationPhoneId }
                    }
                });
                if (existingPhone) {
                    // logger.warn(`⚠️ PhoneJid ${actualPhoneJid} уже используется другим телефоном (ID: ${existingPhone.id}). Обновляем только статус.`);
                    yield authStorage_1.prisma.organizationPhone.update({
                        where: { id: organizationPhoneId },
                        data: { status: 'connected', lastConnectedAt: new Date(), qrCode: null }
                    });
                }
                else {
                    yield authStorage_1.prisma.organizationPhone.update({
                        where: { id: organizationPhoneId },
                        data: { status: 'connected', phoneJid: actualPhoneJid, lastConnectedAt: new Date(), qrCode: null }
                    });
                }
            }
        })));
        // Обработчик обновления учетных данных
        currentSock.ev.on('creds.update', saveCreds); // Используем saveCreds для сохранения
        // ИСПРАВЛЕНИЕ: Добавляем обработчик ошибок синхронизации app state и сессий
        currentSock.ev.on('connection.update', safeAsyncListener('connection.update(recovery)', (update) => __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            // Перехватываем ошибки синхронизации app state
            if ((_a = update.lastDisconnect) === null || _a === void 0 ? void 0 : _a.error) {
                const error = update.lastDisconnect.error;
                // Проверяем на ошибки дешифрования в app state
                if (((_b = error === null || error === void 0 ? void 0 : error.message) === null || _b === void 0 ? void 0 : _b.includes('bad decrypt')) ||
                    ((_c = error === null || error === void 0 ? void 0 : error.message) === null || _c === void 0 ? void 0 : _c.includes('error:1C800064')) ||
                    (error === null || error === void 0 ? void 0 : error.name) === 'critical_unblock_low') {
                    // logger.warn(`⚠️ Обнаружена ошибка дешифрования app state для ${phoneJid}.`);
                    // Вызываем обработчик Bad Decrypt ошибки
                    const recovered = yield handleBadDecryptError(organizationId, organizationPhoneId, phoneJid);
                    if (!recovered) {
                        // logger.error(`❌ Не удалось восстановить сессию после повторяющихся Bad Decrypt ошибок для ${phoneJid}. Сессия закрыта.`);
                        // Сессия уже закрыта в handleBadDecryptError, не пытаемся переподключиться
                        return;
                    }
                }
                // НОВОЕ: Обработка ошибки Bad MAC из libsignal
                if (((_d = error === null || error === void 0 ? void 0 : error.message) === null || _d === void 0 ? void 0 : _d.includes('Bad MAC')) ||
                    ((_e = error === null || error === void 0 ? void 0 : error.message) === null || _e === void 0 ? void 0 : _e.includes('verifyMAC')) ||
                    ((_f = error === null || error === void 0 ? void 0 : error.stack) === null || _f === void 0 ? void 0 : _f.includes('libsignal'))) {
                    // logger.warn(`⚠️ Обнаружена ошибка Bad MAC (libsignal) для ${phoneJid}.`);
                    // Вызываем обработчик Bad MAC ошибки
                    const recovered = yield handleBadMacError(organizationId, organizationPhoneId, phoneJid);
                    if (!recovered) {
                        // logger.error(`❌ Не удалось восстановить сессию после повторяющихся Bad MAC ошибок для ${phoneJid}. Сессия закрыта.`);
                        // Сессия уже закрыта в handleBadMacError, не пытаемся переподключиться
                        return;
                    }
                }
            }
        })));
        // Совместимость с v7: обработчик обновлений LID маппинга (в 6.7.x событие не генерируется)
        try {
            (_b = (_a = currentSock.ev).on) === null || _b === void 0 ? void 0 : _b.call(_a, 'lid-mapping.update', (mapping) => {
                // logger.info(`[LID] lid-mapping.update: ${JSON.stringify(mapping)}`);
                // Здесь можно задействовать currentSock.signalRepository?.lidMapping?.storeLIDPNMappings(mapping)
                // но API может отличаться между версиями — оставляем как информативный лог
            });
        }
        catch (e) {
            // logger.debug('LID mapping event handler not supported in this version');
        }
        // Обработчик получения новых сообщений
        currentSock.ev.on('messages.upsert', safeAsyncListener('messages.upsert', (_a) => __awaiter(this, [_a], void 0, function* ({ messages, type }) {
            var _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o, _p, _q, _r, _s, _t, _u, _v;
            if (type === 'notify') {
                for (const msg of messages) {
                    try {
                        // Пропускаем сообщения без контента или если это наше исходящее сообщение, не имеющее видимого контента
                        if (!msg.message) {
                            // logger.info(`[Message Upsert] Пропущено сообщение без контента (ID: ${msg.key.id})`);
                            continue;
                        }
                        if (msg.key.fromMe && !msg.message.conversation && !msg.message.extendedTextMessage && !msg.message.imageMessage && !msg.message.videoMessage && !msg.message.documentMessage && !msg.message.audioMessage && !msg.message.stickerMessage) {
                            // logger.info(`[Message Upsert] Пропущено исходящее системное сообщение (ID: ${msg.key.id})`);
                            continue;
                        }
                        // v7: поддержка LID alt-идентификаторов. В 6.7.x этих полей нет, поэтому используем fallback.
                        const rawRemote = (_c = (_b = msg.key.remoteJidAlt) !== null && _b !== void 0 ? _b : msg.key.remoteJid) !== null && _c !== void 0 ? _c : '';
                        const remoteJid = (0, baileys_1.jidNormalizedUser)(rawRemote);
                        if (!remoteJid) {
                            // logger.warn('🚫 Сообщение без remoteJid, пропущено.');
                            continue;
                        }
                        // Пропускаем широковещательные сообщения и статусы
                        if ((0, baileys_1.isJidBroadcast)(remoteJid) || remoteJid === 'status@broadcast') {
                            // logger.info(`Пропускаем широковещательное сообщение или статус от ${remoteJid}.`);
                            continue;
                        }
                        try {
                            const rawParticipant = (_e = (_d = msg.key.participantAlt) !== null && _d !== void 0 ? _d : msg.key.participant) !== null && _e !== void 0 ? _e : remoteJid;
                            const senderJid = (0, baileys_1.jidNormalizedUser)(msg.key.fromMe ? (((_f = currentSock === null || currentSock === void 0 ? void 0 : currentSock.user) === null || _f === void 0 ? void 0 : _f.id) || phoneJid) : rawParticipant);
                            let content;
                            let messageType = "unknown";
                            let mediaUrl;
                            let filename;
                            let mimeType;
                            let size;
                            let quotedMessageId;
                            let quotedContent;
                            const messageContent = msg.message;
                            // Разбор различных типов сообщений
                            if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.conversation) {
                                content = messageContent.conversation;
                                messageType = "text";
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: "${content}" от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.extendedTextMessage) {
                                content = messageContent.extendedTextMessage.text || undefined;
                                messageType = "text";
                                // --- ОБРАБОТКА ОТВЕТА ---
                                const contextInfo = messageContent.extendedTextMessage.contextInfo;
                                if (contextInfo === null || contextInfo === void 0 ? void 0 : contextInfo.quotedMessage) {
                                    quotedMessageId = (_g = contextInfo.stanzaId) !== null && _g !== void 0 ? _g : undefined;
                                    const qm = contextInfo.quotedMessage;
                                    // Получаем текст из разных возможных полей цитируемого сообщения
                                    quotedContent = qm.conversation ||
                                        ((_h = qm.extendedTextMessage) === null || _h === void 0 ? void 0 : _h.text) ||
                                        ((_j = qm.imageMessage) === null || _j === void 0 ? void 0 : _j.caption) ||
                                        ((_k = qm.videoMessage) === null || _k === void 0 ? void 0 : _k.caption) ||
                                        ((_l = qm.documentMessage) === null || _l === void 0 ? void 0 : _l.fileName) ||
                                        '[Медиафайл]'; // Плейсхолдер для медиа без текста
                                    // Добавляем информацию об ответе к основному контенту
                                    const replyText = `ответил на: "${quotedContent}"`;
                                    if (content) {
                                        content = `${replyText}\n\n${content}`;
                                    }
                                    else {
                                        content = replyText;
                                    }
                                    if (!msg.key.fromMe) {
                                        logger.info(`  [reply] Ответ на сообщение ID: ${quotedMessageId}`);
                                    }
                                }
                                // --- КОНЕЦ: ОБРАБОТКА ОТВЕТА ---
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: "${content}" от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.imageMessage) {
                                messageType = "image";
                                content = messageContent.imageMessage.caption || undefined;
                                mimeType = messageContent.imageMessage.mimetype || undefined;
                                size = Number(messageContent.imageMessage.fileLength) || undefined;
                                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ ФОТО ---
                                mediaUrl = yield downloadAndSaveMedia(messageContent.imageMessage, 'image');
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: "${content || 'без подписи'}". MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.videoMessage) {
                                messageType = "video";
                                content = messageContent.videoMessage.caption || undefined;
                                mimeType = messageContent.videoMessage.mimetype || undefined;
                                size = Number(messageContent.videoMessage.fileLength) || undefined;
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: "${content || 'без подписи'}". MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.documentMessage) {
                                messageType = "document";
                                filename = messageContent.documentMessage.fileName || undefined;
                                mimeType = messageContent.documentMessage.mimetype || undefined;
                                size = Number(messageContent.documentMessage.fileLength) || undefined;
                                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ ДОКУМЕНТА ---
                                mediaUrl = yield downloadAndSaveMedia(messageContent.documentMessage, 'document', filename);
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: Документ "${filename || 'без имени'}". MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.audioMessage) {
                                messageType = "audio";
                                mimeType = messageContent.audioMessage.mimetype || undefined;
                                size = Number(messageContent.audioMessage.fileLength) || undefined;
                                // --- СКАЧИВАНИЕ И СОХРАНЕНИЕ АУДИО ---
                                mediaUrl = yield downloadAndSaveMedia(messageContent.audioMessage, 'audio');
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: Аудио. MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.stickerMessage) {
                                messageType = "sticker";
                                mimeType = messageContent.stickerMessage.mimetype || undefined;
                                size = Number(messageContent.stickerMessage.fileLength) || undefined;
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: Стикер. MIME: ${mimeType}. Размер: ${size} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.locationMessage) {
                                messageType = "location";
                                content = `Latitude: ${messageContent.locationMessage.degreesLatitude}, Longitude: ${messageContent.locationMessage.degreesLongitude}`;
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: Локация ${content} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.liveLocationMessage) {
                                messageType = "live_location";
                                content = `Live Location: Capt=${messageContent.liveLocationMessage.caption || 'N/A'}, Seq=${messageContent.liveLocationMessage.sequenceNumber}`;
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.contactMessage) {
                                messageType = "contact";
                                content = `Контакт: ${messageContent.contactMessage.displayName || messageContent.contactMessage.vcard}`;
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.contactsArrayMessage) {
                                messageType = "contacts_array";
                                content = `Контакты: ${((_m = messageContent.contactsArrayMessage.contacts) === null || _m === void 0 ? void 0 : _m.map(c => c.displayName || c.vcard).join(', ')) || 'пусто'}`;
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.reactionMessage) {
                                messageType = "reaction";
                                content = `Реакция "${messageContent.reactionMessage.text}" на сообщение ${(_o = messageContent.reactionMessage.key) === null || _o === void 0 ? void 0 : _o.id}`;
                                // Логируем только входящие сообщения
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: ${content} от ${remoteJid}`);
                                }
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.protocolMessage) {
                                messageType = "protocol";
                                content = `Системное сообщение (тип: ${messageContent.protocolMessage.type})`;
                                // Не логируем системные сообщения
                            }
                            else if (messageContent === null || messageContent === void 0 ? void 0 : messageContent.call) {
                                messageType = "call";
                                const callId = messageContent.call.callKey ? buffer_1.Buffer.from(messageContent.call.callKey).toString('hex') : 'unknown';
                                content = `Звонок от ${senderJid} (ID: ${callId})`;
                                // Логируем только входящие звонки
                                if (!msg.key.fromMe) {
                                    logger.info(`📥 [${messageType}] Входящее: ${content}`);
                                }
                            }
                            if (messageType === "unknown" && Object.keys(messageContent || {}).length > 0) {
                                messageType = Object.keys(messageContent || {})[0];
                                logger.warn(`  [${messageType}] Неподдерживаемый или неизвестный тип сообщения. JID: ${remoteJid}`);
                            }
                            else if (messageType === "unknown") {
                                logger.warn(`  [Неизвестный] Сообщение без опознаваемого типа контента. JID: ${remoteJid}`);
                                continue; // Пропускаем сохранение полностью пустых сообщений
                            }
                            // --- ИСПРАВЛЕНО: Более надежная обработка timestamp ---
                            let timestampInSeconds;
                            const ts = msg.messageTimestamp;
                            if (typeof ts === 'number') {
                                timestampInSeconds = ts;
                            }
                            else if (ts && typeof ts === 'object' && typeof ts.toNumber === 'function') {
                                // Это объект Long, преобразуем его в число
                                timestampInSeconds = ts.toNumber();
                            }
                            else {
                                // Запасной вариант, если timestamp не пришел или в неизвестном формате
                                timestampInSeconds = Math.floor(Date.now() / 1000);
                            }
                            const timestampDate = new Date(timestampInSeconds * 1000);
                            // Сохраняем сообщение в БД
                            const myJid = (0, baileys_1.jidNormalizedUser)(((_p = currentSock === null || currentSock === void 0 ? void 0 : currentSock.user) === null || _p === void 0 ? void 0 : _p.id) || phoneJid) || '';
                            const contactName = msg.pushName || undefined;
                            const chatId = yield ensureChat(organizationId, organizationPhoneId, myJid, remoteJid, contactName);
                            // --- АВТОМАТИЧЕСКОЕ СОЗДАНИЕ КЛИЕНТА (ВРЕМЕННО ОТКЛЮЧЕНО) ---
                            // Создаем или обновляем клиента только для входящих сообщений (не от нас)
                            // if (!msg.key.fromMe) {
                            //   try {
                            //     logger.info(`👤 Проверка клиента для ${senderJid}...`);
                            //     const { ensureWhatsAppClient, linkClientToChat } = await import('../services/clientService');
                            //     const client = await ensureWhatsAppClient(organizationId, senderJid, contactName);
                            //     logger.info(`✅ Клиент обработан: ${client.name} (ID: ${client.id})`);
                            //     
                            //     // Связываем клиента с чатом
                            //     await linkClientToChat(client.id, chatId);
                            //     logger.info(`🔗 Клиент #${client.id} связан с чатом #${chatId}`);
                            //   } catch (clientError) {
                            //     logger.error(`⚠️ Ошибка при создании клиента для ${senderJid}:`, clientError);
                            //     // Продолжаем обработку сообщения даже если создание клиента не удалось
                            //   }
                            // } else {
                            //   logger.debug(`⏭️ Пропускаем создание клиента для исходящего сообщения`);
                            // }
                            const savedMessage = yield authStorage_1.prisma.message.create({
                                data: {
                                    chatId: chatId,
                                    organizationPhoneId: organizationPhoneId,
                                    receivingPhoneJid: myJid,
                                    remoteJid: remoteJid,
                                    whatsappMessageId: msg.key.id || `_temp_${Date.now()}_${Math.random()}`,
                                    senderJid: senderJid,
                                    fromMe: msg.key.fromMe || false,
                                    content: content || '',
                                    type: messageType,
                                    mediaUrl: mediaUrl,
                                    filename: filename,
                                    mimeType: mimeType,
                                    size: size,
                                    timestamp: timestampDate,
                                    status: 'received',
                                    organizationId: organizationId,
                                    // Входящие сообщения по умолчанию не прочитаны оператором
                                    isReadByOperator: msg.key.fromMe || false, // Исходящие считаем прочитанными
                                    // --- СОХРАНЕНИЕ ДАННЫХ ОТВЕТОВ ---
                                    quotedMessageId: quotedMessageId,
                                    quotedContent: quotedContent,
                                },
                            });
                            // Увеличиваем счетчик непрочитанных сообщений для входящих сообщений
                            if (!msg.key.fromMe) {
                                yield authStorage_1.prisma.chat.update({
                                    where: { id: chatId },
                                    data: {
                                        unreadCount: {
                                            increment: 1,
                                        },
                                        lastMessageAt: timestampDate,
                                    },
                                });
                                // logger.info(`📬 Увеличен счетчик непрочитанных для чата ${chatId}`);
                            }
                            else {
                                // Для исходящих сообщений только обновляем время последнего сообщения
                                yield authStorage_1.prisma.chat.update({
                                    where: { id: chatId },
                                    data: {
                                        lastMessageAt: timestampDate,
                                    },
                                });
                            }
                            // Отправляем Socket.IO уведомление о новом сообщении
                            try {
                                (0, socketService_1.notifyNewMessage)(organizationId, {
                                    id: savedMessage.id,
                                    chatId: savedMessage.chatId,
                                    content: savedMessage.content,
                                    type: savedMessage.type,
                                    mediaUrl: savedMessage.mediaUrl,
                                    filename: savedMessage.filename,
                                    fromMe: savedMessage.fromMe,
                                    timestamp: savedMessage.timestamp,
                                    status: savedMessage.status,
                                    senderJid: savedMessage.senderJid,
                                });
                            }
                            catch (socketError) {
                                logger.error('[Socket.IO] Ошибка отправки уведомления о новом сообщении:', socketError);
                            }
                            // logger.info(`💾 Сообщение (тип: ${messageType}, ID: ${savedMessage.id}) сохранено в БД (JID собеседника: ${remoteJid}, Ваш номер: ${phoneJid}, chatId: ${savedMessage.chatId}).`);
                        }
                        catch (error) {
                            // Обработка ошибки Bad MAC из libsignal
                            if (((_q = error === null || error === void 0 ? void 0 : error.message) === null || _q === void 0 ? void 0 : _q.includes('Bad MAC')) ||
                                ((_r = error === null || error === void 0 ? void 0 : error.message) === null || _r === void 0 ? void 0 : _r.includes('verifyMAC')) ||
                                ((_s = error === null || error === void 0 ? void 0 : error.stack) === null || _s === void 0 ? void 0 : _s.includes('libsignal'))) {
                                logger.error(`❌ Session error (Bad MAC) при обработке сообщения от ${remoteJid}:`, error.message);
                                // Вызываем обработчик Bad MAC ошибки
                                const recovered = yield handleBadMacError(organizationId, organizationPhoneId, phoneJid);
                                if (recovered) {
                                    logger.info(`✅ Попытка восстановления после Bad MAC для ${phoneJid}. Сообщение будет обработано при повторной отправке.`);
                                }
                                else {
                                    logger.error(`❌ Не удалось восстановить сессию после Bad MAC для ${phoneJid}. Требуется повторная авторизация.`);
                                }
                                // Пропускаем это сообщение, но продолжаем обработку других
                                continue;
                            }
                            // Обработка других ошибок
                            logger.error(`❌ Ошибка при сохранении сообщения в БД для JID ${remoteJid} (Ваш номер: ${phoneJid}):`);
                            if (error instanceof Error) {
                                logger.error('Сообщение об ошибке:', error.message);
                                if (error.stack) {
                                    logger.error('Stack trace:', error.stack);
                                }
                                if ('code' in error && 'meta' in error && typeof error.code === 'string') {
                                    logger.error(`Prisma Error Code: ${error.code}, Meta:`, JSON.stringify(error.meta, null, 2));
                                }
                            }
                            else {
                                logger.error('Неизвестная ошибка:', error);
                            }
                        }
                    }
                    catch (outerError) {
                        // Обработка критических ошибок на уровне обработки сообщения
                        logger.error(`❌ Критическая ошибка при обработке сообщения:`, outerError);
                        // Проверяем на Bad MAC даже на верхнем уровне
                        if (((_t = outerError === null || outerError === void 0 ? void 0 : outerError.message) === null || _t === void 0 ? void 0 : _t.includes('Bad MAC')) ||
                            ((_u = outerError === null || outerError === void 0 ? void 0 : outerError.message) === null || _u === void 0 ? void 0 : _u.includes('verifyMAC')) ||
                            ((_v = outerError === null || outerError === void 0 ? void 0 : outerError.stack) === null || _v === void 0 ? void 0 : _v.includes('libsignal'))) {
                            logger.error(`❌ Критическая Session error (Bad MAC). Попытка восстановления...`);
                            yield handleBadMacError(organizationId, organizationPhoneId, phoneJid);
                        }
                    }
                }
            }
        })));
        return currentSock; // Возвращаем созданный сокет
    });
}
/**
 * Возвращает активный экземпляр WASocket по ID телефона организации.
 * @param organizationPhoneId ID телефона организации.
 * @returns Экземпляр WASocket или null, если не найден.
 */
function getBaileysSock(organizationPhoneId) {
    // logger.info(`[getBaileysSock] Запрошен organizationPhoneId: ${organizationPhoneId}`);
    // logger.info(`[getBaileysSock] Ключи в socks Map: [${Array.from(socks.keys()).join(', ')}]`);
    const sock = socks.get(organizationPhoneId);
    // if (!sock) {
    //   logger.warn(`[getBaileysSock] Сокет не найден для organizationPhoneId: ${organizationPhoneId}`);
    // } else {
    //   logger.info(`[getBaileysSock] Сокет найден для organizationPhoneId: ${organizationPhoneId}. JID сокета: ${sock.user?.id || 'Неизвестно'}`);
    // }
    return sock || null;
}
/**
 * Возвращает статистику ошибок сессии для указанного телефона организации.
 * @param organizationPhoneId ID телефона организации.
 * @returns Объект со статистикой ошибок
 */
function getSessionErrorStats(organizationPhoneId) {
    const badMacErrors = badMacErrorCount.get(organizationPhoneId) || 0;
    const badDecryptErrors = badDecryptErrorCount.get(organizationPhoneId) || 0;
    return {
        badMacErrors,
        badDecryptErrors,
        maxBadMacErrors: MAX_BAD_MAC_ERRORS,
        maxBadDecryptErrors: MAX_BAD_DECRYPT_ERRORS,
        isHealthy: badMacErrors < MAX_BAD_MAC_ERRORS && badDecryptErrors < MAX_BAD_DECRYPT_ERRORS,
    };
}
/**
 * Принудительно закрывает сессию для указанного телефона организации.
 * Полезно для ручного управления сессиями из API.
 * @param organizationPhoneId ID телефона организации
 * @param reason Причина закрытия
 */
function forceCloseSession(organizationPhoneId_1) {
    return __awaiter(this, arguments, void 0, function* (organizationPhoneId, reason = 'Manual close') {
        var _a;
        const sock = socks.get(organizationPhoneId);
        if (!sock) {
            logger.warn(`[forceCloseSession] Сокет не найден для organizationPhoneId: ${organizationPhoneId}`);
            return;
        }
        const phoneJid = ((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id) || 'unknown';
        logger.info(`[forceCloseSession] Принудительное закрытие сессии для ${phoneJid}. Причина: ${reason}`);
        yield closeSession(organizationPhoneId, phoneJid, reason);
        logger.info(`✅ Сессия принудительно закрыта для organizationPhoneId: ${organizationPhoneId}`);
    });
}
/**
 * Отправляет сообщение через Baileys сокет.
 * @param sock Экземпляр WASocket.
 * @param jid JID получателя.
 * @param content Содержимое сообщения.
 */
function sendMessage(sock, jid, content, organizationId, // Добавляем organizationId
organizationPhoneId, // Добавляем organizationPhoneId
senderJid, // Добавляем senderJid (ваш номер)
userId, // <-- ДОБАВЛЕН userId (опционально)
mediaInfo) {
    return __awaiter(this, void 0, void 0, function* () {
        var _a;
        if (!sock || !sock.user) {
            throw new Error('Baileys socket is not connected or user is not defined.');
        }
        try {
            const sentMessage = yield sock.sendMessage(jid, content);
            // Логирование mediaInfo для отладки
            logger.info(`[sendMessage] Получена информация о медиафайле:`, {
                mediaInfo,
                hasMediaUrl: !!(mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.mediaUrl),
                hasFilename: !!(mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.filename),
                hasSize: !!(mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.size)
            });
            // --- НАЧАЛО НОВОГО КОДА ДЛЯ СОХРАНЕНИЯ ---
            if (sentMessage) {
                const remoteJid = (0, baileys_1.jidNormalizedUser)(jid); // JID получателя
                // Определяем тип и содержимое сообщения
                let messageType = 'text';
                let messageContent = '';
                let mediaUrl = mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.mediaUrl; // Используем переданную информацию
                let filename = mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.filename; // Используем переданную информацию
                let mimeType;
                let size = mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.size; // Используем переданную информацию
                // Анализируем содержимое для определения типа
                if (content.text) {
                    messageType = 'text';
                    messageContent = content.text;
                }
                else if (content.image) {
                    messageType = 'image';
                    messageContent = content.caption || '';
                    mimeType = 'image/jpeg'; // По умолчанию
                }
                else if (content.video) {
                    messageType = 'video';
                    messageContent = content.caption || '';
                    mimeType = 'video/mp4'; // По умолчанию
                }
                else if (content.document) {
                    messageType = 'document';
                    filename = filename || content.fileName || 'document'; // Приоритет переданному filename
                    messageContent = content.caption || '';
                    mimeType = 'application/octet-stream'; // По умолчанию
                }
                else if (content.audio) {
                    messageType = 'audio';
                    mimeType = content.mimetype || 'audio/mp4';
                }
                else if (content.sticker) {
                    messageType = 'sticker';
                    mimeType = 'image/webp';
                }
                else {
                    // Для других типов сообщений
                    messageContent = JSON.stringify(content);
                }
                // Получаем chatId для сохранения сообщения
                const myJid = (0, baileys_1.jidNormalizedUser)(((_a = sock.user) === null || _a === void 0 ? void 0 : _a.id) || senderJid) || '';
                const chatId = yield ensureChat(organizationId, organizationPhoneId, myJid, remoteJid);
                // --- НАЧАЛО: УЛУЧШЕННАЯ ПРОВЕРКА И ЛОГИРОВАНИЕ userId ---
                logger.info(`[sendMessage] Проверка userId перед сохранением. Полученное значение: ${userId}, тип: ${typeof userId}`);
                const messageData = {
                    chatId: chatId,
                    organizationPhoneId: organizationPhoneId,
                    receivingPhoneJid: myJid,
                    remoteJid: remoteJid,
                    whatsappMessageId: sentMessage.key.id || `_out_${Date.now()}_${Math.random()}`,
                    senderJid: myJid,
                    fromMe: true,
                    content: messageContent,
                    type: messageType,
                    mediaUrl: mediaUrl,
                    filename: filename,
                    mimeType: mimeType,
                    size: size,
                    timestamp: new Date(),
                    status: 'sent',
                    organizationId: organizationId,
                };
                // Присваиваем senderUserId только если userId является числом
                if (typeof userId === 'number' && !isNaN(userId)) {
                    messageData.senderUserId = userId;
                }
                else {
                    logger.warn(`[sendMessage] userId не является числом (значение: ${userId}). senderUserId не будет установлен.`);
                }
                // --- КОНЕЦ: УЛУЧШЕННАЯ ПРОВЕРКА И ЛОГИРОВАНИЕ userId ---
                // --- ОТЛАДОЧНЫЙ ЛОГ ---
                logger.info({
                    msg: '[sendMessage] Data to be saved to DB',
                    data: messageData,
                    receivedUserId: userId,
                    isUserIdNumber: typeof userId === 'number',
                    mediaInfo: {
                        originalMediaUrl: mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.mediaUrl,
                        originalFilename: mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.filename,
                        originalSize: mediaInfo === null || mediaInfo === void 0 ? void 0 : mediaInfo.size,
                        finalMediaUrl: messageData.mediaUrl,
                        finalFilename: messageData.filename,
                        finalSize: messageData.size
                    }
                }, 'Полные данные для сохранения исходящего сообщения.');
                yield authStorage_1.prisma.message.create({
                    data: messageData,
                });
                logger.info(`✅ Исходящее сообщение "${messageContent}" (ID: ${sentMessage.key.id}) сохранено в БД. Chat ID: ${chatId}, Type: ${messageType}`);
            }
            else {
                logger.warn(`⚠️ Исходящее сообщение на ${jid} не было сохранено: sentMessage is undefined.`);
            }
            // --- КОНЕЦ НОВОГО КОДА ДЛЯ СОХРАНЕНИЯ ---
            return sentMessage;
        }
        catch (error) {
            logger.error(`❌ Ошибка при отправке и/или сохранении исходящего сообщения на ${jid}:`, error);
            throw error; // Перебрасываем ошибку дальше
        }
    });
}
// Обработчик сигнала завершения процесса (например, Ctrl+C)
process.on('SIGINT', () => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c;
    logger.info('Получен сигнал SIGINT. Закрытие Baileys...');
    // Итерируем по всем активным сокетам и закрываем их
    for (const sockToClose of socks.values()) {
        // Проверяем, существует ли сокет и находится ли его WebSocket в состоянии OPEN (числовое значение 1)
        if (sockToClose && sockToClose.ws.readyState === 1) {
            try {
                yield sockToClose.end(new Error('Приложение завершает работу: SIGINT получен.'));
                logger.info(`Baileys socket для JID ${((_a = sockToClose.user) === null || _a === void 0 ? void 0 : _a.id) || 'неизвестно'} закрыт.`);
            }
            catch (e) {
                logger.error(`Ошибка при закрытии сокета: ${e}`);
            }
        }
        else if (sockToClose) {
            logger.info(`Baileys socket для JID ${((_b = sockToClose.user) === null || _b === void 0 ? void 0 : _b.id) || 'неизвестно'} не был в состоянии OPEN (readyState: ${(_c = sockToClose.ws) === null || _c === void 0 ? void 0 : _c.readyState}).`);
        }
    }
    socks.clear(); // Очищаем Map после попытки закрытия всех сокетов
    logger.info('Все Baileys сокеты закрыты.');
    yield authStorage_1.prisma.$disconnect(); // Отключаемся от Prisma Client
    logger.info('Prisma Client отключен.');
    process.exit(0); // Завершаем процесс
}));
//# sourceMappingURL=baileys.js.map