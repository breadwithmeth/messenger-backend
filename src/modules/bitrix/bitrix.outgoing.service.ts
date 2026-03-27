import crypto from 'crypto';
import pino from 'pino';
import { prisma } from '../../config/authStorage';
import { BitrixRepository } from './bitrix.repository';
import { sendTelegramMessage } from '../../services/telegramService';
import { createWABAService } from '../../services/wabaService';
import { getBaileysSock, sendMessage as sendBaileysMessage } from '../../config/baileys';
import { jidNormalizedUser } from '@whiskeysockets/baileys';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

export class BitrixOutgoingService {
  private readonly repository = new BitrixRepository();

  async processWebhook(event: any): Promise<void> {
    if (event?.event !== 'ONCRMCOMMENTADD') {
      logger.debug({ event: event?.event }, '[BitrixOutgoing] Unsupported event');
      return;
    }

    const leadId = Number(event?.data?.FIELDS?.ENTITY_ID);
    const rawComment = event?.data?.FIELDS?.COMMENT as string | undefined;

    if (!leadId || !rawComment) {
      logger.warn({ leadId, hasComment: !!rawComment }, '[BitrixOutgoing] Missing leadId or comment');
      return;
    }

    if (!rawComment.startsWith('#reply')) {
      logger.debug({ leadId }, '[BitrixOutgoing] Comment without #reply skipped');
      return;
    }

    const text = rawComment.replace(/^#reply\s*/i, '').trim();
    if (!text) {
      logger.debug({ leadId }, '[BitrixOutgoing] Empty reply text');
      return;
    }

    const hash = crypto.createHash('sha256').update(`${leadId}|${text}`).digest('hex');
    const alreadyProcessed = await this.repository.isEventProcessed(hash);
    if (alreadyProcessed) {
      logger.info({ leadId, hash }, '[BitrixOutgoing] Duplicate event skipped');
      return;
    }

    const mapping = await this.repository.getMappingByLeadId(leadId);
    if (!mapping?.chatId) {
      logger.error({ leadId }, '[BitrixOutgoing] Mapping not found for lead');
      await this.repository.markEventProcessed(hash, leadId, text);
      return;
    }

    const chat = await prisma.chat.findUnique({
      where: { id: mapping.chatId },
      include: {
        organizationPhone: true,
        telegramBot: true,
      },
    });

    if (!chat) {
      logger.error({ chatId: mapping.chatId }, '[BitrixOutgoing] Chat not found');
      await this.repository.markEventProcessed(hash, leadId, text);
      return;
    }

    try {
      if (chat.channel === 'telegram') {
        if (!chat.telegramBotId || !chat.telegramChatId) {
          throw new Error('Telegram binding missing');
        }
        await sendTelegramMessage(chat.telegramBotId, chat.telegramChatId, text, {});
      } else if (chat.channel === 'whatsapp') {
        if (!chat.organizationPhone) {
          throw new Error('Organization phone missing');
        }

        if (chat.organizationPhone.connectionType === 'waba') {
          const waba = await createWABAService(chat.organizationPhone.id);
          if (!waba) {
            throw new Error('WABA service not configured');
          }
          if (!chat.remoteJid) {
            throw new Error('remoteJid is required for WhatsApp chat');
          }
          const recipientPhone = (chat.remoteJid || '').replace('@s.whatsapp.net', '');
          await waba.sendTextMessage(recipientPhone, text);

          await prisma.message.create({
            data: {
              organizationId: chat.organizationId,
              chatId: chat.id,
              channel: 'whatsapp',
              organizationPhoneId: chat.organizationPhone?.id,
              remoteJid: chat.remoteJid,
              receivingPhoneJid: chat.organizationPhone?.phoneJid,
              fromMe: true,
              content: text,
              type: 'text',
              timestamp: new Date(),
              status: 'sent',
            },
          });
        } else {
          const sock = getBaileysSock(chat.organizationPhone.id);
          if (!sock || !sock.user) {
            throw new Error('Baileys socket not ready');
          }
          const normalizedReceiverJid = jidNormalizedUser(chat.remoteJid || '');
          if (!normalizedReceiverJid) {
            throw new Error('Invalid remoteJid');
          }
          await sendBaileysMessage(
            sock,
            normalizedReceiverJid,
            { text },
            chat.organizationId,
            chat.organizationPhone.id,
            chat.organizationPhone.phoneJid,
            undefined,
          );
        }
      } else {
        throw new Error(`Unsupported channel ${chat.channel}`);
      }

      await prisma.chat.update({ where: { id: chat.id }, data: { lastMessageAt: new Date() } });
      await this.repository.markEventProcessed(hash, leadId, text);
      logger.info({ leadId, chatId: chat.id }, '[BitrixOutgoing] Reply sent');
    } catch (error: any) {
      logger.error({ leadId, chatId: chat.id, message: error?.message }, '[BitrixOutgoing] Send failed');
      await this.repository.markEventProcessed(hash, leadId, text);
    }
  }
}

export const bitrixOutgoingService = new BitrixOutgoingService();
