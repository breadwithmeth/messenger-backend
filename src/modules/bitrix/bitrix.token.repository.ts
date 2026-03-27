import pino from 'pino';
import { prisma } from '../../config/authStorage';
import { BitrixTokenRecord, BitrixTokenUpsertInput } from './bitrix.types';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class BitrixTokenRepository {
  async getByDomain(domain: string): Promise<BitrixTokenRecord | null> {
    const row = await prisma.bitrixToken.findUnique({
      where: { domain },
    });

    return row;
  }

  async upsertByDomain(input: BitrixTokenUpsertInput): Promise<BitrixTokenRecord> {
    const row = await prisma.bitrixToken.upsert({
      where: { domain: input.domain },
      update: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
      },
      create: {
        accessToken: input.accessToken,
        refreshToken: input.refreshToken,
        expiresAt: input.expiresAt,
        domain: input.domain,
      },
    });

    logger.info(
      { domain: input.domain, expiresAt: input.expiresAt.toISOString() },
      '[BitrixTokenRepository] Token saved',
    );

    return row;
  }

  async clearByDomain(domain: string): Promise<void> {
    try {
      await prisma.bitrixToken.delete({ where: { domain } });
    } catch (error: any) {
      if (error?.code !== 'P2025') {
        throw error;
      }
    }
  }
}
