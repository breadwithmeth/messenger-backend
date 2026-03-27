import pino from 'pino';
import { prisma } from '../../config/authStorage';
import { ChatMappingRecord } from './bitrix.types';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export interface BitrixMappingRecord {
  userId: string;
  bitrixContactId: number;
  bitrixLeadId: number | null;
  chatId?: number | null;
}

export class BitrixRepository {
  private readonly mappingCache = new Map<string, BitrixMappingRecord>();
  private readonly leadCache = new Map<number, BitrixMappingRecord>();
  private readonly contactCache = new Map<string, number>();
  private readonly chatMappingCache = new Map<number, ChatMappingRecord>();
  private readonly chatByBitrixCache = new Map<string, ChatMappingRecord>();
  private readonly chatByExternalCache = new Map<string, ChatMappingRecord>();

  private getBitrixChatKey(source: string, bitrixChatId: string): string {
    return `${source.toUpperCase()}:${bitrixChatId}`;
  }

  private getExternalUserKey(source: string, externalUserId: string): string {
    return `${source.toUpperCase()}:${externalUserId}`;
  }

  private cacheChatMapping(data: ChatMappingRecord): void {
    this.chatMappingCache.set(data.chatId, data);

    if (data.bitrixChatId) {
      this.chatByBitrixCache.set(this.getBitrixChatKey(data.source, data.bitrixChatId), data);
    }

    this.chatByExternalCache.set(this.getExternalUserKey(data.source, data.externalUserId), data);
  }

  async getMappingByUserId(userId: string): Promise<BitrixMappingRecord | null> {
    const fromCache = this.mappingCache.get(userId);
    if (fromCache) {
      return fromCache;
    }

    const row = await prisma.bitrixMapping.findUnique({
      where: { userId },
    });

    if (!row) {
      return null;
    }

    const mapped: BitrixMappingRecord = {
      userId: row.userId,
      bitrixContactId: row.bitrixContactId,
      bitrixLeadId: row.bitrixLeadId,
      chatId: row.chatId,
    };

    this.mappingCache.set(userId, mapped);
    if (mapped.bitrixLeadId) {
      this.leadCache.set(mapped.bitrixLeadId, mapped);
    }
    return mapped;
  }

  async getMappingByLeadId(bitrixLeadId: number): Promise<BitrixMappingRecord | null> {
    const cached = this.leadCache.get(bitrixLeadId);
    if (cached) {
      return cached;
    }

    const row = await prisma.bitrixMapping.findFirst({
      where: { bitrixLeadId },
    });

    if (!row) {
      return null;
    }

    const mapped: BitrixMappingRecord = {
      userId: row.userId,
      bitrixContactId: row.bitrixContactId,
      bitrixLeadId: row.bitrixLeadId,
      chatId: row.chatId,
    };

    this.mappingCache.set(row.userId, mapped);
    if (row.bitrixLeadId) {
      this.leadCache.set(row.bitrixLeadId, mapped);
    }
    return mapped;
  }

  setContactCache(phone: string, contactId: number): void {
    this.contactCache.set(phone, contactId);
  }

  getContactCache(phone: string): number | undefined {
    return this.contactCache.get(phone);
  }

  setLeadCache(contactId: number, leadId: number): void {
    this.leadCache.set(leadId, { userId: '', bitrixContactId: contactId, bitrixLeadId: leadId });
  }

  async upsertMapping(data: BitrixMappingRecord): Promise<void> {
    await prisma.bitrixMapping.upsert({
      where: { userId: data.userId },
      update: {
        bitrixContactId: data.bitrixContactId,
        bitrixLeadId: data.bitrixLeadId,
        chatId: data.chatId,
      },
      create: {
        userId: data.userId,
        bitrixContactId: data.bitrixContactId,
        bitrixLeadId: data.bitrixLeadId,
        chatId: data.chatId,
      },
    });

    this.mappingCache.set(data.userId, data);
    if (data.bitrixLeadId) {
      this.leadCache.set(data.bitrixLeadId, data);
    }

    logger.debug(
      { userId: data.userId, bitrixContactId: data.bitrixContactId, bitrixLeadId: data.bitrixLeadId },
      '[BitrixRepository] Mapping saved',
    );
  }

  async isEventProcessed(hash: string): Promise<boolean> {
    const existing = await prisma.bitrixProcessedEvent.findUnique({ where: { hash } });
    return Boolean(existing);
  }

  async markEventProcessed(hash: string, leadId: number, comment: string): Promise<void> {
    await prisma.bitrixProcessedEvent.create({
      data: {
        hash,
        leadId,
        comment,
      },
    });
  }

  async upsertChatMapping(params: {
    chatId: number;
    externalUserId: string;
    bitrixChatId?: string | null;
    source: string;
  }): Promise<void> {
    await prisma.chatMapping.upsert({
      where: { chatId: params.chatId },
      update: {
        externalUserId: params.externalUserId,
        bitrixChatId: params.bitrixChatId,
        source: params.source,
      },
      create: {
        chatId: params.chatId,
        externalUserId: params.externalUserId,
        bitrixChatId: params.bitrixChatId,
        source: params.source,
      },
    });
    this.cacheChatMapping({
      chatId: params.chatId,
      externalUserId: params.externalUserId,
      bitrixChatId: params.bitrixChatId,
      source: params.source,
    });
  }

  async getChatMapping(chatId: number): Promise<ChatMappingRecord | null> {
    const cached = this.chatMappingCache.get(chatId);
    if (cached) return cached;

    const row = await prisma.chatMapping.findUnique({ where: { chatId } });
    if (!row) return null;

    const mapped: ChatMappingRecord = {
      chatId: row.chatId,
      externalUserId: row.externalUserId,
      bitrixChatId: row.bitrixChatId,
      source: row.source,
    };
    this.cacheChatMapping(mapped);
    return mapped;
  }

  async getChatMappingByBitrixChatId(bitrixChatId: string, source?: string): Promise<ChatMappingRecord | null> {
    const normalizedSource = source?.toUpperCase();

    if (normalizedSource) {
      const cached = this.chatByBitrixCache.get(this.getBitrixChatKey(normalizedSource, bitrixChatId));
      if (cached) return cached;
    }

    const row = await prisma.chatMapping.findFirst({
      where: {
        bitrixChatId,
        ...(normalizedSource ? { source: normalizedSource } : {}),
      },
    });

    if (!row) return null;

    const mapped: ChatMappingRecord = {
      chatId: row.chatId,
      externalUserId: row.externalUserId,
      bitrixChatId: row.bitrixChatId,
      source: row.source,
    };

    this.cacheChatMapping(mapped);
    return mapped;
  }

  async getChatMappingByExternalUserId(externalUserId: string, source?: string): Promise<ChatMappingRecord | null> {
    const normalizedSource = source?.toUpperCase();

    if (normalizedSource) {
      const cached = this.chatByExternalCache.get(this.getExternalUserKey(normalizedSource, externalUserId));
      if (cached) return cached;
    }

    const row = await prisma.chatMapping.findFirst({
      where: {
        externalUserId,
        ...(normalizedSource ? { source: normalizedSource } : {}),
      },
    });

    if (!row) return null;

    const mapped: ChatMappingRecord = {
      chatId: row.chatId,
      externalUserId: row.externalUserId,
      bitrixChatId: row.bitrixChatId,
      source: row.source,
    };

    this.cacheChatMapping(mapped);
    return mapped;
  }

  async tryMarkIncomingEventProcessed(params: {
    dedupKey: string;
    source: string;
    bitrixChatId?: string;
    externalUserId?: string;
    externalMessageId?: string;
  }): Promise<boolean> {
    try {
      await prisma.bitrixIncomingEvent.create({
        data: {
          dedupKey: params.dedupKey,
          source: params.source,
          bitrixChatId: params.bitrixChatId,
          externalUserId: params.externalUserId,
          externalMessageId: params.externalMessageId,
        },
      });

      return true;
    } catch (error: any) {
      if (error?.code === 'P2002') {
        return false;
      }
      throw error;
    }
  }

  async unmarkIncomingEventProcessed(dedupKey: string): Promise<void> {
    try {
      await prisma.bitrixIncomingEvent.delete({ where: { dedupKey } });
    } catch (error: any) {
      if (error?.code !== 'P2025') {
        throw error;
      }
    }
  }
}
