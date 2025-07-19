// src/services/mediaService.ts

import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import pino from 'pino';

const logger = pino({ level: 'info' });
const writeFile = promisify(fs.writeFile);
const mkdir = promisify(fs.mkdir);

export interface MediaUploadResult {
  success: boolean;
  filePath?: string;
  url?: string;
  fileName?: string;
  size?: number;
  mimeType?: string;
  error?: string;
}

/**
 * Сохраняет загруженный медиафайл
 */
export const saveUploadedMedia = async (
  fileBuffer: Buffer,
  originalName: string,
  mimeType: string,
  mediaType: 'image' | 'video' | 'document' | 'audio'
): Promise<MediaUploadResult> => {
  try {
    // Создаем директорию для медиафайлов если она не существует
    const mediaDir = path.join(process.cwd(), 'public', 'media', mediaType);
    
    if (!fs.existsSync(mediaDir)) {
      await mkdir(mediaDir, { recursive: true });
    }

    // Генерируем уникальное имя файла
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 8);
    const ext = path.extname(originalName) || getExtensionByMimeType(mimeType);
    const fileName = `${timestamp}_${random}${ext}`;
    const filePath = path.join(mediaDir, fileName);
    
    // Сохраняем файл
    await writeFile(filePath, fileBuffer);
    
    // Создаем URL для доступа к файлу
    const fileUrl = `/media/${mediaType}/${fileName}`;
    
    logger.info(`[saveUploadedMedia] Медиафайл сохранен: ${fileName} (${fileBuffer.length} байт)`);
    
    return {
      success: true,
      filePath,
      url: fileUrl,
      fileName,
      size: fileBuffer.length,
      mimeType,
    };
  } catch (error: any) {
    logger.error(`[saveUploadedMedia] Ошибка сохранения медиафайла:`, error);
    return {
      success: false,
      error: error.message,
    };
  }
};

/**
 * Проверяет валидность медиафайла
 */
export const validateMediaFile = (
  fileBuffer: Buffer,
  mimeType: string,
  mediaType: 'image' | 'video' | 'document' | 'audio'
): { valid: boolean; error?: string } => {
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

/**
 * Получает расширение файла по MIME типу
 */
const getExtensionByMimeType = (mimeType: string): string => {
  const mimeToExt: { [key: string]: string } = {
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
export const deleteMediaFile = async (filePath: string): Promise<boolean> => {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      logger.info(`[deleteMediaFile] Медиафайл удален: ${filePath}`);
      return true;
    }
    return false;
  } catch (error: any) {
    logger.error(`[deleteMediaFile] Ошибка удаления медиафайла:`, error);
    return false;
  }
};

/**
 * Получает информацию о медиафайле
 */
export const getMediaInfo = async (filePath: string): Promise<{
  exists: boolean;
  size?: number;
  mimeType?: string;
  fileName?: string;
}> => {
  try {
    if (!fs.existsSync(filePath)) {
      return { exists: false };
    }

    const stats = fs.statSync(filePath);
    const fileName = path.basename(filePath);
    
    // Определяем MIME тип по расширению
    const ext = path.extname(filePath).toLowerCase();
    const extToMime: { [key: string]: string } = {
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
  } catch (error: any) {
    logger.error(`[getMediaInfo] Ошибка получения информации о файле:`, error);
    return { exists: false };
  }
};
