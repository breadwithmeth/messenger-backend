// src/services/wabaService.ts

import axios from 'axios';
import { prisma } from '../config/authStorage.js';
import { createLogger } from '../config/logging.js';
import { saveMedia } from './storageService.js';

const logger = createLogger();

// Логи сбоев дублируются в console.log, потому что pino-логгер по умолчанию
// молчит (APP_LOG_LEVEL не задан) и ошибки WABA в нём терялись.
const WABA_LOG_SENSITIVE_KEY = /(authorization|cookie|password|secret|token)/i;

function redactForWabaLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(redactForWabaLog);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
      key,
      WABA_LOG_SENSITIVE_KEY.test(key) ? '[REDACTED]' : redactForWabaLog(childValue),
    ])
  );
}

function wabaConsoleLog(event: string, data: Record<string, unknown> = {}) {
  try {
    console.log('[WABA SERVICE]', JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      ...data,
    }));
  } catch (logError) {
    console.log('[WABA SERVICE LOG ERROR]', String(logError));
  }
}

function getWabaAxiosErrorDetails(error: any): Record<string, unknown> {
  const responseData = error?.response?.data;
  const graphError = responseData?.error;

  return {
    errorName: error?.name,
    errorMessage: error?.message,
    errorCode: error?.code,
    errorCause: error?.cause ? String(error?.cause?.message ?? error?.cause) : undefined,
    responseStatus: error?.response?.status,
    responseStatusText: error?.response?.statusText,
    graphErrorCode: graphError?.code,
    graphErrorSubcode: graphError?.error_subcode,
    graphErrorType: graphError?.type,
    graphErrorMessage: graphError?.message,
    graphErrorFbtraceId: graphError?.fbtrace_id,
    graphErrorIsTransient: graphError?.is_transient,
    responseData: redactForWabaLog(responseData),
  };
}

function logWabaFailure(event: string, error: any, context: Record<string, unknown> = {}): void {
  const details = { event, ...context, ...getWabaAxiosErrorDetails(error) };
  logger.error(`❌ WABA: ${event}`, details);
  wabaConsoleLog(event, details);
}

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

interface GetTemplatesOptions {
  limit?: number;
  after?: string;
  name?: string;
  language?: string;
  status?: string;
  category?: string;
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
      logWabaFailure('send-message-failed', error, {
        messageType: options.type,
        to: options.to,
        phoneNumberId: this.config.phoneNumberId,
        apiVersion: this.config.apiVersion,
      });
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
   * Отправка WhatsApp Flow (интерактивная форма)
   */
  async sendFlowMessage(
    to: string,
    options: {
      flowId: string;
      flowToken: string;
      ctaText?: string;
      headerText?: string;
      bodyText: string;
      footerText?: string;
      screen?: string;
      mode?: 'published' | 'draft';
    }
  ): Promise<any> {
    const interactive: any = {
      type: 'flow',
      body: { text: options.bodyText },
      action: {
        name: 'flow',
        parameters: {
          flow_message_version: '3',
          flow_token: options.flowToken,
          flow_id: options.flowId,
          flow_cta: options.ctaText || 'Заполнить форму',
          // mode (published|draft) находится на уровне parameters, а не внутри flow_action_payload
          mode: options.mode || 'published',
          flow_action: 'navigate',
          flow_action_payload: {
            screen: options.screen || 'COLLECT_DATA',
          },
        },
      },
    };
    if (options.headerText) {
      interactive.header = { type: 'text', text: options.headerText };
    }
    if (options.footerText) {
      interactive.footer = { text: options.footerText };
    }

    return this.sendMessage({
      to,
      type: 'interactive',
      interactive,
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
   * Получить шаблоны WABA из Graph API
   */
  async getTemplates(options: GetTemplatesOptions = {}): Promise<any> {
    if (!this.config.wabaId) {
      throw new Error('WABA ID is missing. Set wabaId for this organization phone.');
    }

    const url = `${this.baseUrl}/${this.config.wabaId}/message_templates`;

    const params: Record<string, any> = {
      limit: Number(options.limit) > 0 ? Number(options.limit) : 50,
      fields: 'id,name,language,status,category,components',
    };

    if (options.after) params.after = options.after;
    if (options.name) params.name = options.name;
    if (options.language) params.language = options.language;
    if (options.status) params.status = options.status;
    if (options.category) params.category = options.category;

    try {
      const response = await axios.get(url, {
        headers: {
          'Authorization': `Bearer ${this.config.accessToken}`,
        },
        params,
      });

      return response.data;
    } catch (error: any) {
      logWabaFailure('get-templates-failed', error, {
        wabaId: this.config.wabaId,
        apiVersion: this.config.apiVersion,
        params: redactForWabaLog(params),
      });
      throw error;
    }
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
      logWabaFailure('mark-as-read-failed', error, {
        messageId,
        phoneNumberId: this.config.phoneNumberId,
        apiVersion: this.config.apiVersion,
      });
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
      logWabaFailure('upload-media-failed', error, {
        phoneNumberId: this.config.phoneNumberId,
        apiVersion: this.config.apiVersion,
        fileUrl,
        mimeType,
      });
      throw error;
    }
  }

  /**
   * Скачать медиа-файл из WhatsApp и загрузить на R2
   */
  async downloadAndUploadMedia(mediaId: string, mimeType: string): Promise<string> {
    let step = 'get-media-url';
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
      step = 'download-file';
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
      step = 'upload-to-r2';
      const publicUrl = await saveMedia(buffer, filename, mimeType);
      logger.info(`✅ WABA: Файл загружен на R2: ${publicUrl}`);

      return publicUrl;
    } catch (error: any) {
      logWabaFailure('download-media-failed', error, {
        mediaId,
        mimeType,
        step,
        apiVersion: this.config.apiVersion,
      });
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
      wabaConsoleLog('config-incomplete', {
        organizationPhoneId,
        phoneFound: Boolean(orgPhone),
        hasAccessToken: Boolean(orgPhone?.wabaAccessToken),
        hasPhoneNumberId: Boolean(orgPhone?.wabaPhoneNumberId),
        hasWabaId: Boolean(orgPhone?.wabaId),
      });
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
    wabaConsoleLog('config-db-error', {
      organizationPhoneId,
      errorMessage: error instanceof Error ? error.message : String(error),
    });
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
