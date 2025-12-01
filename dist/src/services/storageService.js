"use strict";
// src/services/storageService.ts
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
var _a;
Object.defineProperty(exports, "__esModule", { value: true });
exports.saveMedia = saveMedia;
exports.deleteMedia = deleteMedia;
exports.getSignedMediaUrl = getSignedMediaUrl;
exports.mediaExists = mediaExists;
const client_s3_1 = require("@aws-sdk/client-s3");
const s3_request_presigner_1 = require("@aws-sdk/s3-request-presigner");
const promises_1 = __importDefault(require("fs/promises"));
const path_1 = __importDefault(require("path"));
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
// Конфигурация хранилища
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local'; // 'local', 'r2', 's3'
logger.info(`🗄️  [Storage] Инициализация Storage Service:`);
logger.info(`   - STORAGE_TYPE: ${STORAGE_TYPE}`);
// Cloudflare R2 клиент
const r2Client = STORAGE_TYPE === 'r2' ? new client_s3_1.S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
}) : null;
if (STORAGE_TYPE === 'r2') {
    logger.info(`   - R2 Endpoint: https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
    logger.info(`   - R2 Bucket: ${process.env.R2_BUCKET_NAME}`);
    logger.info(`   - R2 Public URL: ${process.env.R2_PUBLIC_URL || 'Not configured'}`);
    logger.info(`   - R2 Access Key ID: ${(_a = process.env.R2_ACCESS_KEY_ID) === null || _a === void 0 ? void 0 : _a.substring(0, 8)}...`);
}
// Amazon S3 клиент
const s3Client = STORAGE_TYPE === 's3' ? new client_s3_1.S3Client({
    region: process.env.AWS_REGION || 'us-east-1',
    credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    },
}) : null;
/**
 * Сохранение медиафайла
 */
function saveMedia(buffer, filename, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        const timestamp = Date.now();
        const random = Math.round(Math.random() * 1E9);
        const extension = path_1.default.extname(filename);
        const uniqueFilename = `${timestamp}-${random}${extension}`;
        switch (STORAGE_TYPE) {
            case 'r2':
                return yield uploadToR2(buffer, uniqueFilename, mimeType);
            case 's3':
                return yield uploadToS3(buffer, uniqueFilename, mimeType);
            case 'local':
            default:
                return yield saveLocally(buffer, uniqueFilename);
        }
    });
}
/**
 * Загрузка в Cloudflare R2
 */
function uploadToR2(buffer, filename, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!r2Client) {
            throw new Error('R2 client not initialized');
        }
        const key = `media/${filename}`;
        logger.info(`📤 [R2] Начало загрузки файла:`);
        logger.info(`   - Bucket: ${process.env.R2_BUCKET_NAME}`);
        logger.info(`   - Key: ${key}`);
        logger.info(`   - Size: ${buffer.length} bytes`);
        logger.info(`   - MimeType: ${mimeType}`);
        try {
            const command = new client_s3_1.PutObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: key,
                Body: buffer,
                ContentType: mimeType,
            });
            const result = yield r2Client.send(command);
            logger.info(`✅ [R2] Файл успешно загружен в R2:`);
            logger.info(`   - Key: ${key}`);
            logger.info(`   - ETag: ${result.ETag}`);
            logger.info(`   - VersionId: ${result.VersionId || 'N/A'}`);
            // Если bucket публичный, используем публичный URL
            if (process.env.R2_PUBLIC_URL) {
                const publicUrl = `${process.env.R2_PUBLIC_URL}/${key}`;
                logger.info(`   - Public URL: ${publicUrl}`);
                return publicUrl;
            }
            // Если bucket приватный, генерируем подписанный URL (7 дней)
            const signedUrl = yield (0, s3_request_presigner_1.getSignedUrl)(r2Client, new client_s3_1.GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: key,
            }), { expiresIn: 3600 * 24 * 7 });
            return signedUrl;
        }
        catch (error) {
            logger.error(`❌ [R2] Ошибка загрузки в R2:`);
            logger.error(`   - Bucket: ${process.env.R2_BUCKET_NAME}`);
            logger.error(`   - Key: ${key}`);
            logger.error(`   - Error Code: ${error.Code || error.code || 'N/A'}`);
            logger.error(`   - Error Message: ${error.message}`);
            logger.error(`   - Full Error:`, error);
            throw error;
        }
    });
}
/**
 * Загрузка в Amazon S3
 */
function uploadToS3(buffer, filename, mimeType) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!s3Client) {
            throw new Error('S3 client not initialized');
        }
        const key = `media/${filename}`;
        try {
            yield s3Client.send(new client_s3_1.PutObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: key,
                Body: buffer,
                ContentType: mimeType,
            }));
            logger.info(`✅ Файл загружен в S3: ${key}`);
            return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
        }
        catch (error) {
            logger.error('❌ Ошибка загрузки в S3:', error);
            throw error;
        }
    });
}
/**
 * Сохранение локально
 */
function saveLocally(buffer, filename) {
    return __awaiter(this, void 0, void 0, function* () {
        const mediaDir = path_1.default.join(__dirname, '..', '..', 'public', 'media');
        yield promises_1.default.mkdir(mediaDir, { recursive: true });
        const filePath = path_1.default.join(mediaDir, filename);
        yield promises_1.default.writeFile(filePath, buffer);
        logger.info(`✅ Файл сохранен локально: ${filePath}`);
        return `/media/${filename}`;
    });
}
/**
 * Удаление медиафайла
 */
function deleteMedia(mediaUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!mediaUrl)
            return;
        switch (STORAGE_TYPE) {
            case 'r2':
                yield deleteFromR2(mediaUrl);
                break;
            case 's3':
                yield deleteFromS3(mediaUrl);
                break;
            case 'local':
            default:
                yield deleteLocally(mediaUrl);
                break;
        }
    });
}
/**
 * Удаление из R2
 */
function deleteFromR2(mediaUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!r2Client)
            return;
        try {
            // Извлекаем ключ из URL
            const key = mediaUrl.includes('/media/')
                ? mediaUrl.split('/media/')[1]
                : mediaUrl;
            yield r2Client.send(new client_s3_1.DeleteObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: `media/${key}`,
            }));
            logger.info(`🗑️ Файл удален из R2: ${key}`);
        }
        catch (error) {
            logger.error('❌ Ошибка удаления из R2:', error);
        }
    });
}
/**
 * Удаление из S3
 */
function deleteFromS3(mediaUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!s3Client)
            return;
        try {
            const key = mediaUrl.includes('/media/')
                ? mediaUrl.split('/media/')[1]
                : mediaUrl;
            yield s3Client.send(new client_s3_1.DeleteObjectCommand({
                Bucket: process.env.S3_BUCKET_NAME,
                Key: `media/${key}`,
            }));
            logger.info(`🗑️ Файл удален из S3: ${key}`);
        }
        catch (error) {
            logger.error('❌ Ошибка удаления из S3:', error);
        }
    });
}
/**
 * Удаление локального файла
 */
function deleteLocally(mediaUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!mediaUrl.startsWith('/media/'))
            return;
        try {
            const filePath = path_1.default.join(__dirname, '..', '..', 'public', mediaUrl);
            yield promises_1.default.unlink(filePath);
            logger.info(`🗑️ Файл удален локально: ${filePath}`);
        }
        catch (error) {
            logger.error('❌ Ошибка удаления локального файла:', error);
        }
    });
}
/**
 * Получение подписанного URL для приватных файлов R2
 */
function getSignedMediaUrl(mediaUrl_1) {
    return __awaiter(this, arguments, void 0, function* (mediaUrl, expiresInSeconds = 3600) {
        if (STORAGE_TYPE !== 'r2' || !r2Client) {
            return mediaUrl; // Для локального или публичного хранилища возвращаем как есть
        }
        try {
            const key = mediaUrl.includes('/media/')
                ? `media/${mediaUrl.split('/media/')[1]}`
                : mediaUrl;
            const signedUrl = yield (0, s3_request_presigner_1.getSignedUrl)(r2Client, new client_s3_1.GetObjectCommand({
                Bucket: process.env.R2_BUCKET_NAME,
                Key: key,
            }), { expiresIn: expiresInSeconds });
            return signedUrl;
        }
        catch (error) {
            logger.error('❌ Ошибка генерации подписанного URL:', error);
            return mediaUrl;
        }
    });
}
/**
 * Проверка существования файла
 */
function mediaExists(mediaUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!mediaUrl)
            return false;
        switch (STORAGE_TYPE) {
            case 'r2':
            case 's3':
                return yield checkCloudStorage(mediaUrl);
            case 'local':
            default:
                return yield checkLocalStorage(mediaUrl);
        }
    });
}
function checkCloudStorage(mediaUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        const client = STORAGE_TYPE === 'r2' ? r2Client : s3Client;
        if (!client)
            return false;
        try {
            const key = mediaUrl.includes('/media/')
                ? `media/${mediaUrl.split('/media/')[1]}`
                : mediaUrl;
            const bucket = STORAGE_TYPE === 'r2'
                ? process.env.R2_BUCKET_NAME
                : process.env.S3_BUCKET_NAME;
            yield client.send(new client_s3_1.GetObjectCommand({
                Bucket: bucket,
                Key: key,
            }));
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
function checkLocalStorage(mediaUrl) {
    return __awaiter(this, void 0, void 0, function* () {
        if (!mediaUrl.startsWith('/media/'))
            return false;
        try {
            const filePath = path_1.default.join(__dirname, '..', '..', 'public', mediaUrl);
            yield promises_1.default.access(filePath);
            return true;
        }
        catch (_a) {
            return false;
        }
    });
}
//# sourceMappingURL=storageService.js.map