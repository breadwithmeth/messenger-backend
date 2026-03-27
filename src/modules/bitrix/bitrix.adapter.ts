import axios, { AxiosInstance } from 'axios';
import pino from 'pino';
import {
  BitrixAddResponse,
  BitrixContact,
  BitrixContactAddFields,
  BitrixLead,
  BitrixLeadAddFields,
  BitrixLeadStatus,
  BitrixListResponse,
  BitrixTimelineCommentFields,
} from './bitrix.types';
import { BitrixHttpClient } from './bitrix.http.client';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class BitrixAdapter {
  private readonly webhookClient: AxiosInstance | null;
  private readonly oauthClient: BitrixHttpClient | null;
  private lastCallTs = 0;
  private readonly rateLimitMs = Number(process.env.BITRIX_RATE_LIMIT_MS || 200);

  constructor(webhookUrl?: string) {
    if (webhookUrl) {
      const baseURL = webhookUrl.endsWith('/') ? webhookUrl : `${webhookUrl}/`;
      this.webhookClient = axios.create({
        baseURL,
        timeout: 15000,
        headers: {
          'Content-Type': 'application/json',
        },
      });
    } else {
      this.webhookClient = null;
    }

    const bitrixDomain = process.env.BITRIX_DOMAIN?.trim();
    this.oauthClient = bitrixDomain ? new BitrixHttpClient(bitrixDomain) : null;
  }

  async findContactByPhone(normalizedPhone: string): Promise<BitrixContact | null> {
    const payload = {
      filter: {
        PHONE: normalizedPhone,
      },
      select: ['ID', 'NAME', 'PHONE'],
      start: 0,
    };

    const response = await this.post<BitrixListResponse<BitrixContact>>('crm.contact.list', payload);
    return response.result?.[0] ?? null;
  }

  async createContact(fields: BitrixContactAddFields): Promise<number> {
    const response = await this.post<BitrixAddResponse>('crm.contact.add', { fields });
    return response.result;
  }

  async findActiveLeadByContactId(contactId: number): Promise<BitrixLead | null> {
    const payload = {
      filter: {
        CONTACT_ID: contactId,
        STATUS_ID: ['NEW', 'IN_PROCESS'] as BitrixLeadStatus[],
      },
      order: {
        ID: 'DESC',
      },
      select: ['ID', 'CONTACT_ID', 'STATUS_ID', 'TITLE'],
      start: 0,
    };

    const response = await this.post<BitrixListResponse<BitrixLead>>('crm.lead.list', payload);
    return response.result?.[0] ?? null;
  }

  async createLead(fields: BitrixLeadAddFields): Promise<number> {
    const response = await this.post<BitrixAddResponse>('crm.lead.add', { fields });
    return response.result;
  }

  async addTimelineComment(fields: BitrixTimelineCommentFields): Promise<void> {
    await this.post<BitrixAddResponse>('crm.timeline.comment.add', { fields });
  }

  private async post<TResponse>(method: string, payload: unknown): Promise<TResponse> {
    const now = Date.now();
    const waitMs = Math.max(0, this.lastCallTs + this.rateLimitMs - now);
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastCallTs = Date.now();

    const startedAt = Date.now();

    try {
      logger.info({ method }, '[BitrixAdapter] Outgoing request');

      let data: TResponse;
      if (this.oauthClient) {
        data = await this.oauthClient.post<TResponse>(method, payload);
      } else if (this.webhookClient) {
        ({ data } = await this.webhookClient.post<TResponse>(method, payload));
      } else {
        throw new Error('Neither BITRIX_DOMAIN nor BITRIX_WEBHOOK_URL is configured');
      }

      logger.info(
        { method, durationMs: Date.now() - startedAt },
        '[BitrixAdapter] Request completed',
      );

      return data;
    } catch (error: any) {
      logger.error(
        {
          method,
          durationMs: Date.now() - startedAt,
          status: error?.response?.status,
          message: error?.message,
        },
        '[BitrixAdapter] Request failed',
      );
      throw error;
    }
  }
}
