import pino from 'pino';
import { prisma } from '../../config/authStorage';
import { BitrixAdapter } from './bitrix.adapter';
import { BitrixRepository } from './bitrix.repository';
import { BitrixSource, SyncMessageContext } from './bitrix.types';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const BITRIX_WEBHOOK_URL = process.env.BITRIX_WEBHOOK_URL;
const BITRIX_DOMAIN = process.env.BITRIX_DOMAIN;
const rawDefaultSource = (process.env.BITRIX_DEFAULT_SOURCE || 'WHATSAPP').toUpperCase();
const BITRIX_DEFAULT_SOURCE: BitrixSource =
  rawDefaultSource === 'TELEGRAM' || rawDefaultSource === 'WHATSAPP' ? rawDefaultSource : 'WHATSAPP';

class BitrixService {
  private readonly adapter: BitrixAdapter | null;
  private readonly repository = new BitrixRepository();
  private readonly leadCache = new Map<number, number>(); // contactId -> leadId

  constructor() {
    this.adapter = BITRIX_WEBHOOK_URL || BITRIX_DOMAIN ? new BitrixAdapter(BITRIX_WEBHOOK_URL) : null;

    if (!BITRIX_WEBHOOK_URL && !BITRIX_DOMAIN) {
      logger.warn('[BitrixService] BITRIX_WEBHOOK_URL/BITRIX_DOMAIN are not configured. Sync is disabled.');
    }
  }

  async syncMessage(messageId: string): Promise<void> {
    if (!this.adapter) {
      return;
    }

    const numericMessageId = Number(messageId);
    if (!Number.isInteger(numericMessageId) || numericMessageId <= 0) {
      logger.warn({ messageId }, '[BitrixService] Invalid messageId for sync');
      return;
    }

    const context = await this.buildSyncContext(numericMessageId);
    if (!context) {
      return;
    }

    const comment = `[${context.channel.toUpperCase()}][${context.direction}]\n${context.text}`;

    const existingMapping = await this.repository.getMappingByUserId(context.externalUserId);

    let contactId = existingMapping?.bitrixContactId;
    if (!contactId) {
      const cachedContactId = this.repository.getContactCache(context.normalizedPhone);
      const existingContact = cachedContactId
        ? ({ ID: String(cachedContactId) } as any)
        : await this.adapter.findContactByPhone(context.normalizedPhone);
      if (existingContact?.ID) {
        contactId = Number(existingContact.ID);
      } else {
        contactId = await this.adapter.createContact({
          NAME: context.displayName,
          PHONE: [{ VALUE: context.normalizedPhone, VALUE_TYPE: 'WORK' }],
          SOURCE_ID: this.getSourceId(context.channel),
        });
      }

      this.repository.setContactCache(context.normalizedPhone, contactId);
    }

    let leadId = existingMapping?.bitrixLeadId ?? null;
    if (!leadId) {
      const cachedLeadId = this.leadCache.get(contactId);
      const lead = cachedLeadId
        ? ({ ID: String(cachedLeadId) } as any)
        : await this.adapter.findActiveLeadByContactId(contactId);
      if (lead?.ID) {
        leadId = Number(lead.ID);
      } else {
        leadId = await this.adapter.createLead({
          TITLE: `${context.displayName} (${context.normalizedPhone})`,
          CONTACT_ID: contactId,
          SOURCE_ID: this.getSourceId(context.channel),
          STATUS_ID: 'NEW',
        });
      }

      this.leadCache.set(contactId, leadId);
    }

    await this.adapter.addTimelineComment({
      ENTITY_ID: leadId,
      ENTITY_TYPE: 'lead',
      COMMENT: comment,
    });

    await this.repository.upsertMapping({
      userId: context.externalUserId,
      bitrixContactId: contactId,
      bitrixLeadId: leadId,
      chatId: context.chatId,
    });

    logger.info(
      {
        messageId: numericMessageId,
        contactId,
        leadId,
        externalUserId: context.externalUserId,
      },
      '[BitrixService] Message synced to Bitrix',
    );
  }

  private async buildSyncContext(messageId: number): Promise<SyncMessageContext | null> {
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        chat: {
          include: {
            organizationClients: {
              select: {
                name: true,
                phone: true,
                contactPhone: true,
              },
              take: 1,
            },
          },
        },
      },
    });

    if (!message) {
      logger.warn({ messageId }, '[BitrixService] Message not found');
      return null;
    }

    const text = (message.content || '').trim();
    const isSystem = message.type === 'protocol' || message.type === 'system';

    if (!text || isSystem) {
      logger.debug({ messageId, type: message.type }, '[BitrixService] Message skipped by filter');
      return null;
    }

    const chat = message.chat;
    const orgClient = chat.organizationClients?.[0];

    const rawPhone =
      chat.remoteJid ||
      message.senderJid ||
      chat.receivingPhoneJid ||
      orgClient?.phone ||
      orgClient?.contactPhone ||
      null;

    const normalizedPhone = this.normalizePhone(rawPhone);
    if (!normalizedPhone) {
      logger.warn({ messageId, rawPhone }, '[BitrixService] Message skipped: no valid phone');
      return null;
    }

    const externalUserId =
      chat.channel === 'telegram'
        ? `org:${chat.organizationId}:telegram:${chat.telegramUserId || chat.telegramChatId || chat.id}`
        : `org:${chat.organizationId}:whatsapp:${chat.remoteJid || message.senderJid || chat.id}`;

    const displayName =
      chat.name ||
      orgClient?.name ||
      message.telegramUsername ||
      message.telegramUserId ||
      normalizedPhone;

    return {
      messageId,
      channel: chat.channel || message.channel || 'whatsapp',
      direction: message.fromMe ? 'OUT' : 'IN',
      text,
      externalUserId,
      displayName,
      normalizedPhone,
      chatId: chat.id,
    };
  }

  private normalizePhone(rawPhone: string | null): string | null {
    if (!rawPhone) {
      return null;
    }

    let digits = rawPhone.replace(/\D/g, '');

    if (digits.length === 11 && digits.startsWith('8')) {
      digits = `7${digits.slice(1)}`;
    }

    if (digits.length === 10 && digits.startsWith('7')) {
      digits = `7${digits}`;
    }

    if (digits.length !== 11 || !digits.startsWith('7')) {
      return null;
    }

    return `+${digits}`;
  }

  private getSourceId(channel: string): BitrixSource {
    const normalized = channel.toUpperCase();
    if (normalized === 'TELEGRAM') {
      return 'TELEGRAM';
    }

    if (normalized === 'WHATSAPP') {
      return 'WHATSAPP';
    }

    return BITRIX_DEFAULT_SOURCE;
  }
}

export const bitrixService = new BitrixService();
