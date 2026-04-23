// src/services/wabaService.ts

import axios from 'axios';
import { prisma } from '../config/authStorage';
import pino from 'pino';
import { saveMedia } from './storageService';

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

interface WABAConfig {
  accessToken: string;
  phoneNumberId: string;
  wabaId: string;
  apiVersion: string;
}

interface SendMessageOptions {
  to: string;
  type: 'text' | 'template' | 'interactive' | 'image' | 'document' | 'audio' | 'video';
  text?: string;
  template?: {
    name: string;
    language: string;
    components?: any[];
  };
  interactive?: any;
  image?: {
    link?: string;
    id?: string;
    caption?: string;
  };
  document?: {
    link?: string;
    id?: string;
    caption?: string;
    filename?: string;
  };
  audio?: {
    link?: string;
    id?: string;
  };
  video?: {
    link?: string;
    id?: string;
    caption?: string;
  };
}

export class WABAService {
  private config: WABAConfig;
  private baseUrl: string;

  constructor(config: WABAConfig) {
    this.config = config;
    this.baseUrl = `https://graph.facebook.com/${config.apiVersion}`;
  }

  /**
   * Отправка сообщения через WhatsApp Business API
   */
  async sendMessage(options: SendMessageOptions): Promise<any> {
    const url = `${this.baseUrl}/${this.config.phoneNumberId}/messages`;

    const requestBody: any = {
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
          name: options.template?.name,
          language: { code: options.template?.language || 'ru' },
          components: options.template?.components || [],
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
      const response = await axios.post(url, requestBody, {
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      logger.info(`📤 WABA: Сообщение отправлено. ID: ${response.data.messages?.[0]?.id}`);
      return response.data;
    } catch (error: any) {
      logger.error('❌ WABA: Ошибка отправки сообщения:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Отправка текстового сообщения
   */
  async sendTextMessage(to: string, text: string): Promise<any> {
    return this.sendMessage({
      to,
      type: 'text',
      text,
    });
  }

  /**
   * Отправка шаблонного сообщения
   */
  async sendTemplateMessage(
    to: string,
    templateName: string,
    language: string = 'ru',
    components?: any[]
  ): Promise<any> {
    return this.sendMessage({
      to,
      type: 'template',
      template: {
        name: templateName,
        language,
        components,
      },
    });
  }

  /**
   * Отправка интерактивного сообщения с кнопками
   */
  async sendInteractiveMessage(
    to: string,
    bodyText: string,
    buttons: Array<{ id: string; title: string }>
  ): Promise<any> {
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
  }

  /**
   * Отправка изображения
   */
  async sendImage(to: string, imageUrl: string, caption?: string): Promise<any> {
    return this.sendMessage({
      to,
      type: 'image',
      image: {
        link: imageUrl,
        caption,
      },
    });
  }

  /**
   * Отправка документа
   */
  async sendDocument(to: string, documentUrl: string, filename?: string, caption?: string): Promise<any> {
    return this.sendMessage({
      to,
      type: 'document',
      document: {
        link: documentUrl,
        filename,
        caption,
      },
    });
  }

  /**
   * Отметить сообщение как прочитанное
   */
  async markAsRead(messageId: string): Promise<any> {
    const url = `${this.baseUrl}/${this.config.phoneNumberId}/messages`;

    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data;
    } catch (error: any) {
      logger.error('❌ WABA: Ошибка отметки как прочитанного:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Загрузить медиафайл на серверы WhatsApp
   */
  async uploadMedia(fileUrl: string, mimeType: string): Promise<string> {
    const url = `${this.baseUrl}/${this.config.phoneNumberId}/media`;

    try {
      const response = await axios.post(
        url,
        {
          messaging_product: 'whatsapp',
          file: fileUrl,
          type: mimeType,
        },
        {
          headers: {
            'Authorization': `Bearer ${this.config.accessToken}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.id;
    } catch (error: any) {
      logger.error('❌ WABA: Ошибка загрузки медиа:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Скачать медиа-файл из WhatsApp и загрузить на R2
   */
  async downloadAndUploadMedia(mediaId: string, mimeType: string): Promise<string> {
    try {
      // Шаг 1: Получаем URL медиа-файла
      const mediaInfoUrl = `${this.baseUrl}/${mediaId}`;
      const mediaInfoResponse = await axios.get(mediaInfoUrl, {
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
        },
      });

      const mediaUrl = mediaInfoResponse.data.url;
      logger.info(`📥 WABA: Получен URL медиа-файла: ${mediaId}`);

      // Шаг 2: Скачиваем файл
      const mediaResponse = await axios.get(mediaUrl, {
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
      const publicUrl = await saveMedia(buffer, filename, mimeType);
      logger.info(`✅ WABA: Файл загружен на R2: ${publicUrl}`);

      return publicUrl;
    } catch (error: any) {
      logger.error('❌ WABA: Ошибка скачивания/загрузки медиа:', error.response?.data || error.message);
      throw error;
    }
  }

  /**
   * Получить расширение файла по MIME-типу
   */
  private getExtensionFromMimeType(mimeType: string): string {
    const mimeMap: { [key: string]: string } = {
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

/**
 * Получить WABA конфигурацию для организации
 */
export async function getWABAConfig(organizationPhoneId: number): Promise<WABAConfig | null> {
  try {
    const orgPhone = await prisma.organizationPhone.findUnique({
      where: { id: organizationPhoneId },
      select: {
        wabaAccessToken: true,
        wabaPhoneNumberId: true,
        wabaId: true,
        wabaApiVersion: true,
      },
    });

    if (!orgPhone?.wabaAccessToken || !orgPhone?.wabaPhoneNumberId) {
      return null;
    }

    return {
      accessToken: orgPhone.wabaAccessToken,
      phoneNumberId: orgPhone.wabaPhoneNumberId,
      wabaId: orgPhone.wabaId || '',
      apiVersion: orgPhone.wabaApiVersion || 'v21.0',
    };
  } catch (error) {
    logger.error('❌ Ошибка получения WABA конфигурации:', error);
    return null;
  }
}

/**
 * Создать экземпляр WABA сервиса для организации
 */
export async function createWABAService(organizationPhoneId: number): Promise<WABAService | null> {
  const config = await getWABAConfig(organizationPhoneId);
  if (!config) {
    return null;
  }
  return new WABAService(config);
}
