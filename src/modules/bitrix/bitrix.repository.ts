import pino from 'pino';
import { prisma } from '../../config/authStorage';

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
  private readonly chatMappingCache = new Map<number, { externalUserId: string; bitrixChatId?: string | null; source: string }>();

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
    this.chatMappingCache.set(params.chatId, {
      externalUserId: params.externalUserId,
      bitrixChatId: params.bitrixChatId,
      source: params.source,
    });
  }

  async getChatMapping(chatId: number): Promise<{ externalUserId: string; bitrixChatId?: string | null; source: string } | null> {
    const cached = this.chatMappingCache.get(chatId);
    if (cached) return cached;

    const row = await prisma.chatMapping.findUnique({ where: { chatId } });
    if (!row) return null;

    const mapped = {
      externalUserId: row.externalUserId,
      bitrixChatId: row.bitrixChatId,
      source: row.source,
    };
    this.chatMappingCache.set(chatId, mapped);
    return mapped;
  }
}
