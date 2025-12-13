"use strict";
// src/services/wabaService.ts
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
exports.WABAService = void 0;
exports.getWABAConfig = getWABAConfig;
exports.createWABAService = createWABAService;
const axios_1 = __importDefault(require("axios"));
const authStorage_1 = require("../config/authStorage");
const pino_1 = __importDefault(require("pino"));
const storageService_1 = require("./storageService");
const logger = (0, pino_1.default)({ level: 'info' });
class WABAService {
    constructor(config) {
        this.config = config;
        this.baseUrl = `https://graph.facebook.com/${config.apiVersion}`;
    }
    /**
     * Отправка сообщения через WhatsApp Business API
     */
    sendMessage(options) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a, _b, _c, _d, _e, _f;
            const url = `${this.baseUrl}/${this.config.phoneNumberId}/messages`;
            const requestBody = {
                messaging_product: 'whatsapp',
                recipient_type: 'individual',
                to: options.to,
                type: options.type,
            };
            // Добавляем контент в зависимости от типа
            switch (options.type) {
                case 'text':
                    requestBody.text = { body: options.text };
                    break;
                case 'template':
                    requestBody.template = {
                        name: (_a = options.template) === null || _a === void 0 ? void 0 : _a.name,
                        language: { code: ((_b = options.template) === null || _b === void 0 ? void 0 : _b.language) || 'ru' },
                        components: ((_c = options.template) === null || _c === void 0 ? void 0 : _c.components) || [],
                    };
                    break;
                case 'interactive':
                    requestBody.interactive = options.interactive;
                    break;
                case 'image':
                    requestBody.image = options.image;
                    break;
                case 'document':
                    requestBody.document = options.document;
                    break;
                case 'audio':
                    requestBody.audio = options.audio;
                    break;
                case 'video':
                    requestBody.video = options.video;
                    break;
            }
            try {
                const response = yield axios_1.default.post(url, requestBody, {
                    headers: {
                        'Authorization': `Bearer ${this.config.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });
                logger.info(`📤 WABA: Сообщение отправлено. ID: ${(_e = (_d = response.data.messages) === null || _d === void 0 ? void 0 : _d[0]) === null || _e === void 0 ? void 0 : _e.id}`);
                return response.data;
            }
            catch (error) {
                logger.error('❌ WABA: Ошибка отправки сообщения:', ((_f = error.response) === null || _f === void 0 ? void 0 : _f.data) || error.message);
                throw error;
            }
        });
    }
    /**
     * Отправка текстового сообщения
     */
    sendTextMessage(to, text) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.sendMessage({
                to,
                type: 'text',
                text,
            });
        });
    }
    /**
     * Отправка шаблонного сообщения
     */
    sendTemplateMessage(to_1, templateName_1) {
        return __awaiter(this, arguments, void 0, function* (to, templateName, language = 'ru', components) {
            return this.sendMessage({
                to,
                type: 'template',
                template: {
                    name: templateName,
                    language,
                    components,
                },
            });
        });
    }
    /**
     * Отправка интерактивного сообщения с кнопками
     */
    sendInteractiveMessage(to, bodyText, buttons) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.sendMessage({
                to,
                type: 'interactive',
                interactive: {
                    type: 'button',
                    body: { text: bodyText },
                    action: {
                        buttons: buttons.map(btn => ({
                            type: 'reply',
                            reply: {
                                id: btn.id,
                                title: btn.title,
                            },
                        })),
                    },
                },
            });
        });
    }
    /**
     * Отправка изображения
     */
    sendImage(to, imageUrl, caption) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.sendMessage({
                to,
                type: 'image',
                image: {
                    link: imageUrl,
                    caption,
                },
            });
        });
    }
    /**
     * Отправка документа
     */
    sendDocument(to, documentUrl, filename, caption) {
        return __awaiter(this, void 0, void 0, function* () {
            return this.sendMessage({
                to,
                type: 'document',
                document: {
                    link: documentUrl,
                    filename,
                    caption,
                },
            });
        });
    }
    /**
     * Отметить сообщение как прочитанное
     */
    markAsRead(messageId) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const url = `${this.baseUrl}/${this.config.phoneNumberId}/messages`;
            try {
                const response = yield axios_1.default.post(url, {
                    messaging_product: 'whatsapp',
                    status: 'read',
                    message_id: messageId,
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.config.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });
                return response.data;
            }
            catch (error) {
                logger.error('❌ WABA: Ошибка отметки как прочитанного:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                throw error;
            }
        });
    }
    /**
     * Загрузить медиафайл на серверы WhatsApp
     */
    uploadMedia(fileUrl, mimeType) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            const url = `${this.baseUrl}/${this.config.phoneNumberId}/media`;
            try {
                const response = yield axios_1.default.post(url, {
                    messaging_product: 'whatsapp',
                    file: fileUrl,
                    type: mimeType,
                }, {
                    headers: {
                        'Authorization': `Bearer ${this.config.accessToken}`,
                        'Content-Type': 'application/json',
                    },
                });
                return response.data.id;
            }
            catch (error) {
                logger.error('❌ WABA: Ошибка загрузки медиа:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                throw error;
            }
        });
    }
    /**
     * Скачать медиа-файл из WhatsApp и загрузить на R2
     */
    downloadAndUploadMedia(mediaId, mimeType) {
        return __awaiter(this, void 0, void 0, function* () {
            var _a;
            try {
                // Шаг 1: Получаем URL медиа-файла
                const mediaInfoUrl = `${this.baseUrl}/${mediaId}`;
                const mediaInfoResponse = yield axios_1.default.get(mediaInfoUrl, {
                    headers: {
                        'Authorization': `Bearer ${this.config.accessToken}`,
                    },
                });
                const mediaUrl = mediaInfoResponse.data.url;
                logger.info(`📥 WABA: Получен URL медиа-файла: ${mediaId}`);
                // Шаг 2: Скачиваем файл
                const mediaResponse = yield axios_1.default.get(mediaUrl, {
                    headers: {
                        'Authorization': `Bearer ${this.config.accessToken}`,
                    },
                    responseType: 'arraybuffer',
                });
                const buffer = Buffer.from(mediaResponse.data);
                logger.info(`📦 WABA: Скачан файл размером ${buffer.length} байт`);
                // Шаг 3: Определяем расширение файла
                const ext = this.getExtensionFromMimeType(mimeType);
                const timestamp = Date.now();
                const random = Math.random().toString(36).substring(2, 8);
                const filename = `waba_${timestamp}_${random}${ext}`;
                // Шаг 4: Загружаем на R2
                const publicUrl = yield (0, storageService_1.saveMedia)(buffer, filename, mimeType);
                logger.info(`✅ WABA: Файл загружен на R2: ${publicUrl}`);
                return publicUrl;
            }
            catch (error) {
                logger.error('❌ WABA: Ошибка скачивания/загрузки медиа:', ((_a = error.response) === null || _a === void 0 ? void 0 : _a.data) || error.message);
                throw error;
            }
        });
    }
    /**
     * Получить расширение файла по MIME-типу
     */
    getExtensionFromMimeType(mimeType) {
        const mimeMap = {
            'image/jpeg': '.jpg',
            'image/jpg': '.jpg',
            'image/png': '.png',
            'image/gif': '.gif',
            'image/webp': '.webp',
            'video/mp4': '.mp4',
            'video/mpeg': '.mpeg',
            'video/webm': '.webm',
            'audio/mpeg': '.mp3',
            'audio/mp3': '.mp3',
            'audio/ogg': '.ogg',
            'audio/wav': '.wav',
            'audio/aac': '.aac',
            'audio/mp4': '.m4a',
            'application/pdf': '.pdf',
            'application/msword': '.doc',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
            'application/vnd.ms-excel': '.xls',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
            'text/plain': '.txt',
            'text/csv': '.csv',
        };
        return mimeMap[mimeType] || '';
    }
}
exports.WABAService = WABAService;
/**
 * Получить WABA конфигурацию для организации
 */
function getWABAConfig(organizationPhoneId) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            const orgPhone = yield authStorage_1.prisma.organizationPhone.findUnique({
                where: { id: organizationPhoneId },
                select: {
                    wabaAccessToken: true,
                    wabaPhoneNumberId: true,
                    wabaId: true,
                    wabaApiVersion: true,
                },
            });
            if (!(orgPhone === null || orgPhone === void 0 ? void 0 : orgPhone.wabaAccessToken) || !(orgPhone === null || orgPhone === void 0 ? void 0 : orgPhone.wabaPhoneNumberId)) {
                return null;
            }
            return {
                accessToken: orgPhone.wabaAccessToken,
                phoneNumberId: orgPhone.wabaPhoneNumberId,
                wabaId: orgPhone.wabaId || '',
                apiVersion: orgPhone.wabaApiVersion || 'v21.0',
            };
        }
        catch (error) {
            logger.error('❌ Ошибка получения WABA конфигурации:', error);
            return null;
        }
    });
}
/**
 * Создать экземпляр WABA сервиса для организации
 */
function createWABAService(organizationPhoneId) {
    return __awaiter(this, void 0, void 0, function* () {
        const config = yield getWABAConfig(organizationPhoneId);
        if (!config) {
            return null;
        }
        return new WABAService(config);
    });
}
//# sourceMappingURL=wabaService.js.map