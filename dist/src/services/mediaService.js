"use strict";
// src/services/mediaService.ts
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
exports.getMediaInfo = exports.deleteMediaFile = exports.validateMediaFile = exports.saveUploadedMedia = void 0;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const util_1 = require("util");
const pino_1 = __importDefault(require("pino"));
const storageService_1 = require("./storageService"); // Импорт универсального storage
const logger = (0, pino_1.default)({ level: 'info' });
const writeFile = (0, util_1.promisify)(fs_1.default.writeFile);
const mkdir = (0, util_1.promisify)(fs_1.default.mkdir);
/**
 * Сохраняет загруженный медиафайл (через универсальный storageService)
 */
const saveUploadedMedia = (fileBuffer, originalName, mimeType, mediaType) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        // Генерируем уникальное имя файла
        const timestamp = Date.now();
        const random = Math.random().toString(36).substring(2, 8);
        const ext = path_1.default.extname(originalName) || getExtensionByMimeType(mimeType);
        const fileName = `${mediaType}_${timestamp}_${random}${ext}`;
        // Используем универсальный storage service (R2/S3/local)
        const fileUrl = yield (0, storageService_1.saveMedia)(fileBuffer, fileName, mimeType);
        logger.info(`[saveUploadedMedia] Медиафайл сохранен: ${fileName} (${fileBuffer.length} байт) → ${fileUrl}`);
        return {
            success: true,
            url: fileUrl,
            fileName,
            size: fileBuffer.length,
            mimeType,
        };
    }
    catch (error) {
        logger.error(`[saveUploadedMedia] Ошибка сохранения медиафайла:`, error);
        return {
            success: false,
            error: error.message,
        };
    }
});
exports.saveUploadedMedia = saveUploadedMedia;
/**
 * Проверяет валидность медиафайла
 */
const validateMediaFile = (fileBuffer, mimeType, mediaType) => {
    // Максимальные размеры файлов (в байтах)
    const maxSizes = {
        image: 10 * 1024 * 1024, // 10MB
        video: 50 * 1024 * 1024, // 50MB
        document: 20 * 1024 * 1024, // 20MB
        audio: 15 * 1024 * 1024, // 15MB
    };
    // Проверяем размер файла
    if (fileBuffer.length > maxSizes[mediaType]) {
        return {
            valid: false,
            error: `Файл слишком большой. Максимальный размер для ${mediaType}: ${Math.round(maxSizes[mediaType] / 1024 / 1024)}MB`,
        };
    }
    // Проверяем MIME тип
    const allowedMimeTypes = {
        image: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
        video: ['video/mp4', 'video/avi', 'video/mov', 'video/wmv', 'video/webm'],
        document: [
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-excel',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'text/plain',
            'text/csv',
        ],
        audio: ['audio/mp3', 'audio/wav', 'audio/ogg', 'audio/mpeg', 'audio/mp4'],
    };
    if (!allowedMimeTypes[mediaType].includes(mimeType)) {
        return {
            valid: false,
            error: `Неподдерживаемый тип файла. Разрешенные типы для ${mediaType}: ${allowedMimeTypes[mediaType].join(', ')}`,
        };
    }
    return { valid: true };
};
exports.validateMediaFile = validateMediaFile;
/**
 * Получает расширение файла по MIME типу
 */
const getExtensionByMimeType = (mimeType) => {
    const mimeToExt = {
        'image/jpeg': '.jpg',
        'image/png': '.png',
        'image/gif': '.gif',
        'image/webp': '.webp',
        'video/mp4': '.mp4',
        'video/avi': '.avi',
        'video/mov': '.mov',
        'video/wmv': '.wmv',
        'video/webm': '.webm',
        'audio/mp3': '.mp3',
        'audio/wav': '.wav',
        'audio/ogg': '.ogg',
        'audio/mpeg': '.mp3',
        'audio/mp4': '.m4a',
        'application/pdf': '.pdf',
        'application/msword': '.doc',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
        'application/vnd.ms-excel': '.xls',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
        'text/plain': '.txt',
        'text/csv': '.csv',
    };
    return mimeToExt[mimeType] || '.bin';
};
/**
 * Удаляет медиафайл
 */
const deleteMediaFile = (filePath) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (fs_1.default.existsSync(filePath)) {
            fs_1.default.unlinkSync(filePath);
            logger.info(`[deleteMediaFile] Медиафайл удален: ${filePath}`);
            return true;
        }
        return false;
    }
    catch (error) {
        logger.error(`[deleteMediaFile] Ошибка удаления медиафайла:`, error);
        return false;
    }
});
exports.deleteMediaFile = deleteMediaFile;
/**
 * Получает информацию о медиафайле
 */
const getMediaInfo = (filePath) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!fs_1.default.existsSync(filePath)) {
            return { exists: false };
        }
        const stats = fs_1.default.statSync(filePath);
        const fileName = path_1.default.basename(filePath);
        // Определяем MIME тип по расширению
        const ext = path_1.default.extname(filePath).toLowerCase();
        const extToMime = {
            '.jpg': 'image/jpeg',
            '.jpeg': 'image/jpeg',
            '.png': 'image/png',
            '.gif': 'image/gif',
            '.webp': 'image/webp',
            '.mp4': 'video/mp4',
            '.avi': 'video/avi',
            '.mov': 'video/mov',
            '.wmv': 'video/wmv',
            '.webm': 'video/webm',
            '.mp3': 'audio/mpeg',
            '.wav': 'audio/wav',
            '.ogg': 'audio/ogg',
            '.m4a': 'audio/mp4',
            '.pdf': 'application/pdf',
            '.doc': 'application/msword',
            '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            '.xls': 'application/vnd.ms-excel',
            '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            '.txt': 'text/plain',
            '.csv': 'text/csv',
        };
        return {
            exists: true,
            size: stats.size,
            mimeType: extToMime[ext] || 'application/octet-stream',
            fileName,
        };
    }
    catch (error) {
        logger.error(`[getMediaInfo] Ошибка получения информации о файле:`, error);
        return { exists: false };
    }
});
exports.getMediaInfo = getMediaInfo;
//# sourceMappingURL=mediaService.js.map