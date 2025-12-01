// src/services/storageService.ts

import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import fs from 'fs/promises';
import path from 'path';
import pino from 'pino';

const logger = pino({ level: 'info' });

// Конфигурация хранилища
const STORAGE_TYPE = process.env.STORAGE_TYPE || 'local'; // 'local', 'r2', 's3'

logger.info(`🗄️  [Storage] Инициализация Storage Service:`);
logger.info(`   - STORAGE_TYPE: ${STORAGE_TYPE}`);

// Cloudflare R2 клиент
const r2Client = STORAGE_TYPE === 'r2' ? new S3Client({
  region: 'auto',
  endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.R2_SECRET_ACCESS_KEY!,
  },
}) : null;

if (STORAGE_TYPE === 'r2') {
  logger.info(`   - R2 Endpoint: https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  logger.info(`   - R2 Bucket: ${process.env.R2_BUCKET_NAME}`);
  logger.info(`   - R2 Public URL: ${process.env.R2_PUBLIC_URL || 'Not configured'}`);
  logger.info(`   - R2 Access Key ID: ${process.env.R2_ACCESS_KEY_ID?.substring(0, 8)}...`);
}

// Amazon S3 клиент
const s3Client = STORAGE_TYPE === 's3' ? new S3Client({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  },
}) : null;

/**
 * Сохранение медиафайла
 */
export async function saveMedia(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  const timestamp = Date.now();
  const random = Math.round(Math.random() * 1E9);
  const extension = path.extname(filename);
  const uniqueFilename = `${timestamp}-${random}${extension}`;

  switch (STORAGE_TYPE) {
    case 'r2':
      return await uploadToR2(buffer, uniqueFilename, mimeType);
    case 's3':
      return await uploadToS3(buffer, uniqueFilename, mimeType);
    case 'local':
    default:
      return await saveLocally(buffer, uniqueFilename);
  }
}

/**
 * Загрузка в Cloudflare R2
 */
async function uploadToR2(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
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
    const command = new PutObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    });

    const result = await r2Client.send(command);
    
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
    const signedUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
      { expiresIn: 3600 * 24 * 7 }
    );

    return signedUrl;
  } catch (error: any) {
    logger.error(`❌ [R2] Ошибка загрузки в R2:`);
    logger.error(`   - Bucket: ${process.env.R2_BUCKET_NAME}`);
    logger.error(`   - Key: ${key}`);
    logger.error(`   - Error Code: ${error.Code || error.code || 'N/A'}`);
    logger.error(`   - Error Message: ${error.message}`);
    logger.error(`   - Full Error:`, error);
    throw error;
  }
}

/**
 * Загрузка в Amazon S3
 */
async function uploadToS3(
  buffer: Buffer,
  filename: string,
  mimeType: string
): Promise<string> {
  if (!s3Client) {
    throw new Error('S3 client not initialized');
  }

  const key = `media/${filename}`;

  try {
    await s3Client.send(new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }));

    logger.info(`✅ Файл загружен в S3: ${key}`);

    return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
  } catch (error) {
    logger.error('❌ Ошибка загрузки в S3:', error);
    throw error;
  }
}

/**
 * Сохранение локально
 */
async function saveLocally(
  buffer: Buffer,
  filename: string
): Promise<string> {
  const mediaDir = path.join(__dirname, '..', '..', 'public', 'media');
  await fs.mkdir(mediaDir, { recursive: true });

  const filePath = path.join(mediaDir, filename);
  await fs.writeFile(filePath, buffer);

  logger.info(`✅ Файл сохранен локально: ${filePath}`);

  return `/media/${filename}`;
}

/**
 * Удаление медиафайла
 */
export async function deleteMedia(mediaUrl: string): Promise<void> {
  if (!mediaUrl) return;

  switch (STORAGE_TYPE) {
    case 'r2':
      await deleteFromR2(mediaUrl);
      break;
    case 's3':
      await deleteFromS3(mediaUrl);
      break;
    case 'local':
    default:
      await deleteLocally(mediaUrl);
      break;
  }
}

/**
 * Удаление из R2
 */
async function deleteFromR2(mediaUrl: string): Promise<void> {
  if (!r2Client) return;

  try {
    // Извлекаем ключ из URL
    const key = mediaUrl.includes('/media/') 
      ? mediaUrl.split('/media/')[1]
      : mediaUrl;

    await r2Client.send(new DeleteObjectCommand({
      Bucket: process.env.R2_BUCKET_NAME!,
      Key: `media/${key}`,
    }));

    logger.info(`🗑️ Файл удален из R2: ${key}`);
  } catch (error) {
    logger.error('❌ Ошибка удаления из R2:', error);
  }
}

/**
 * Удаление из S3
 */
async function deleteFromS3(mediaUrl: string): Promise<void> {
  if (!s3Client) return;

  try {
    const key = mediaUrl.includes('/media/')
      ? mediaUrl.split('/media/')[1]
      : mediaUrl;

    await s3Client.send(new DeleteObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME!,
      Key: `media/${key}`,
    }));

    logger.info(`🗑️ Файл удален из S3: ${key}`);
  } catch (error) {
    logger.error('❌ Ошибка удаления из S3:', error);
  }
}

/**
 * Удаление локального файла
 */
async function deleteLocally(mediaUrl: string): Promise<void> {
  if (!mediaUrl.startsWith('/media/')) return;

  try {
    const filePath = path.join(__dirname, '..', '..', 'public', mediaUrl);
    await fs.unlink(filePath);
    logger.info(`🗑️ Файл удален локально: ${filePath}`);
  } catch (error) {
    logger.error('❌ Ошибка удаления локального файла:', error);
  }
}

/**
 * Получение подписанного URL для приватных файлов R2
 */
export async function getSignedMediaUrl(
  mediaUrl: string,
  expiresInSeconds: number = 3600
): Promise<string> {
  if (STORAGE_TYPE !== 'r2' || !r2Client) {
    return mediaUrl; // Для локального или публичного хранилища возвращаем как есть
  }

  try {
    const key = mediaUrl.includes('/media/')
      ? `media/${mediaUrl.split('/media/')[1]}`
      : mediaUrl;

    const signedUrl = await getSignedUrl(
      r2Client,
      new GetObjectCommand({
        Bucket: process.env.R2_BUCKET_NAME!,
        Key: key,
      }),
      { expiresIn: expiresInSeconds }
    );

    return signedUrl;
  } catch (error) {
    logger.error('❌ Ошибка генерации подписанного URL:', error);
    return mediaUrl;
  }
}

/**
 * Проверка существования файла
 */
export async function mediaExists(mediaUrl: string): Promise<boolean> {
  if (!mediaUrl) return false;

  switch (STORAGE_TYPE) {
    case 'r2':
    case 's3':
      return await checkCloudStorage(mediaUrl);
    case 'local':
    default:
      return await checkLocalStorage(mediaUrl);
  }
}

async function checkCloudStorage(mediaUrl: string): Promise<boolean> {
  const client = STORAGE_TYPE === 'r2' ? r2Client : s3Client;
  if (!client) return false;

  try {
    const key = mediaUrl.includes('/media/')
      ? `media/${mediaUrl.split('/media/')[1]}`
      : mediaUrl;

    const bucket = STORAGE_TYPE === 'r2'
      ? process.env.R2_BUCKET_NAME!
      : process.env.S3_BUCKET_NAME!;

    await client.send(new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    }));

    return true;
  } catch {
    return false;
  }
}

async function checkLocalStorage(mediaUrl: string): Promise<boolean> {
  if (!mediaUrl.startsWith('/media/')) return false;

  try {
    const filePath = path.join(__dirname, '..', '..', 'public', mediaUrl);
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
