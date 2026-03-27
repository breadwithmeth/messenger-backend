import axios, { AxiosInstance } from 'axios';
import pino from 'pino';
import { BitrixConnectorMessagePayload, BitrixIncomingMessageContext, ChatSource } from './bitrix.types';
import { BitrixRepository } from './bitrix.repository';
import { prisma } from '../../config/authStorage';
import { createWABAService } from '../../services/wabaService';
import { getBaileysSock, sendMessage as sendBaileysMessage } from '../../config/baileys';
import { jidNormalizedUser } from '../../utils/jid';
import { sendTelegramMessage } from '../../services/telegramService';
import { bitrixAuthService } from './bitrix.auth.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

const rawWebhook = process.env.BITRIX_WEBHOOK_URL || '';
const BITRIX_DOMAIN = process.env.BITRIX_DOMAIN || '';
const HAS_WEBHOOK_CREDENTIALS = /\/rest\/\d+\/[A-Za-z0-9_\-]+\/?$/.test(rawWebhook);
const BITRIX_WEBHOOK_URL = HAS_WEBHOOK_CREDENTIALS
  ? rawWebhook
  : rawWebhook.replace(/\/rest\/\d+\/[A-Za-z0-9_\-]+\/?$/, '/rest/');
const BITRIX_LINE_ID = process.env.BITRIX_LINE_ID || '';
const CONNECTOR_CODE = process.env.BITRIX_CONNECTOR_CODE || 'myconnector';
const BITRIX_APP_TOKEN = process.env.BITRIX_APP_TOKEN || '';

const RATE_LIMIT_MS = Number(process.env.BITRIX_RATE_LIMIT_MS || 200);

export class BitrixConnectorService {
  private readonly client: AxiosInstance;
  private readonly repo = new BitrixRepository();
  private lastCallTs = 0;
  private readonly incomingSeen = new Map<string, number>();
  private readonly incomingTtlMs = 5 * 60 * 1000;
  private readonly outgoingSuppression = new Map<string, number>();
  private readonly outgoingSuppressionTtlMs = 2 * 60 * 1000;
  private lastMissingAuthLogTs = 0;

  private logSkip(reason: string, context: Record<string, unknown>): void {
    logger.info({ reason, ...context }, '[BitrixConnector] Message skipped');
  }

  constructor() {
    const explicitRestBase = BITRIX_DOMAIN ? `https://${BITRIX_DOMAIN}/rest/` : '';
    const baseURL = explicitRestBase || (BITRIX_WEBHOOK_URL.endsWith('/') ? BITRIX_WEBHOOK_URL : `${BITRIX_WEBHOOK_URL}/`);

    this.client = axios.create({
      baseURL,
      timeout: 15000,
    });
  }

  async sendToBitrix(messageId: number): Promise<void> {
    if (!BITRIX_WEBHOOK_URL || !BITRIX_LINE_ID) {
      logger.warn('[BitrixConnector] BITRIX_WEBHOOK_URL or BITRIX_LINE_ID not configured');
      return;
    }

    const message = await prisma.message.findUnique({
      where: { id: messageId },
      include: {
        chat: true,
      },
    });

    if (!message) {
      this.logSkip('message_not_found', { messageId });
      return;
    }

    const suppressionKey = this.getOutboundSuppressionKey(message.chatId, message.content || '');
    const suppressionTs = this.outgoingSuppression.get(suppressionKey);
    if (suppressionTs && Date.now() - suppressionTs < this.outgoingSuppressionTtlMs) {
      this.logSkip('suppressed_echo_message', { messageId, chatId: message.chatId });
      return;
    }

    const text = (message.content || '').trim();
    if (!text) {
      this.logSkip('empty_text', {
        messageId,
        chatId: message.chatId,
        fromMe: message.fromMe,
        type: message.type,
        channel: message.channel,
      });
      return;
    }

    const source: ChatSource = message.channel === 'telegram' ? 'TELEGRAM' : 'WHATSAPP';
    const existingMapping = await this.repo.getChatMapping(message.chatId);
    const chatExternalId = existingMapping?.bitrixChatId || String(message.chatId);
    const externalUserId =
      existingMapping?.externalUserId ||
      message.telegramUserId ||
      message.remoteJid ||
      message.senderJid ||
      `chat:${message.chatId}`;
    const displayName = message.telegramUsername || message.senderJid || 'User';

    await this.repo.upsertChatMapping({
      chatId: message.chatId,
      externalUserId,
      bitrixChatId: chatExternalId,
      source,
    });

    const payload: BitrixConnectorMessagePayload = {
      CONNECTOR: CONNECTOR_CODE,
      LINE: Number(BITRIX_LINE_ID) || BITRIX_LINE_ID,
      MESSAGES: [
        {
          user: {
            id: externalUserId,
            name: displayName,
          },
          chat: {
            id: chatExternalId,
          },
          message: {
            id: `msg-${message.id}`,
            date: Math.floor(new Date(message.timestamp || Date.now()).getTime() / 1000),
            text,
          },
        },
      ],
    };

    await this.rateLimit();
    const started = Date.now();
    try {
      const authToken = await this.getAuthToken();
      if (authToken === null && !HAS_WEBHOOK_CREDENTIALS) {
        this.logSkip('no_auth_context', {
          messageId,
          chatId: message.chatId,
          fromMe: message.fromMe,
          channel: message.channel,
        });
        this.logMissingAuthOnce();
        return;
      }

      if (authToken) {
        payload.auth = authToken;
      }

      const { data } = await this.client.post('imconnector.send.messages', payload);
      logger.info({ messageId, durationMs: Date.now() - started, data }, '[BitrixConnector] Sent to Bitrix');
    } catch (error: any) {
      logger.error({ messageId, status: error?.response?.status, response: error?.response?.data }, '[BitrixConnector] Send failed');
      throw error;
    }
  }

  private async getAuthToken(): Promise<string | null> {
    if (BITRIX_APP_TOKEN) {
      return BITRIX_APP_TOKEN;
    }

    // If webhook URL already contains /rest/{userId}/{token}/, Bitrix authenticates the request by URL.
    if (HAS_WEBHOOK_CREDENTIALS) {
      return null;
    }

    try {
      return await bitrixAuthService.getValidAccessToken();
    } catch (error: any) {
      logger.warn(
        { message: error?.message },
        '[BitrixConnector] Failed to get OAuth token. Complete /integrations/bitrix/connect first',
      );
      return null;
    }
  }

  private logMissingAuthOnce(): void {
    const now = Date.now();
    if (now - this.lastMissingAuthLogTs < 60_000) {
      return;
    }

    this.lastMissingAuthLogTs = now;
    logger.warn(
      {
        hasWebhookCredentials: HAS_WEBHOOK_CREDENTIALS,
      },
      '[BitrixConnector] No auth context. Configure full webhook URL (/rest/{user}/{token}/) or complete OAuth connect',
    );
  }

  async handleIncomingFromBitrix(payload: any): Promise<void> {
    const parsed = this.parseIncomingPayload(payload);
    if (!parsed) {
      this.logSkip('incoming_payload_invalid', { hasData: Boolean(payload?.data) });
      return;
    }

    const { text, source, bitrixChatId, externalUserId, externalMessageId, localChatIdCandidate } = parsed;

    const dedupKey = externalMessageId
      ? `msg:${externalMessageId}`
      : `fallback:${source}:${bitrixChatId || '-'}:${externalUserId || '-'}:${text}`;

    const now = Date.now();
    const prev = this.incomingSeen.get(dedupKey);
    if (prev && now - prev < this.incomingTtlMs) {
      this.logSkip('incoming_duplicate', { dedupKey });
      return;
    }

    const marked = await this.repo.tryMarkIncomingEventProcessed({
      dedupKey,
      source,
      bitrixChatId,
      externalUserId,
      externalMessageId,
    });

    if (!marked) {
      this.logSkip('incoming_duplicate_persistent', { dedupKey });
      return;
    }

    this.incomingSeen.set(dedupKey, now);

    let resolvedChatId: number | null = null;

    if (bitrixChatId) {
      const byBitrixChat = await this.repo.getChatMappingByBitrixChatId(bitrixChatId, source);
      if (byBitrixChat?.chatId) {
        resolvedChatId = byBitrixChat.chatId;
      }
    }

    if (!resolvedChatId && externalUserId) {
      const byExternalUser = await this.repo.getChatMappingByExternalUserId(externalUserId, source);
      if (byExternalUser?.chatId) {
        resolvedChatId = byExternalUser.chatId;
      }
    }

    if (!resolvedChatId && localChatIdCandidate) {
      resolvedChatId = localChatIdCandidate;
    }

    if (!resolvedChatId) {
      this.logSkip('incoming_chat_mapping_not_found', { source, bitrixChatId, externalUserId });
      await this.repo.unmarkIncomingEventProcessed(dedupKey);
      return;
    }

    const chat = await prisma.chat.findUnique({
      where: { id: resolvedChatId },
      include: {
        organizationPhone: true,
        telegramBot: true,
      },
    });

    if (!chat) {
      this.logSkip('incoming_chat_not_found', { chatId: resolvedChatId });
      await this.repo.unmarkIncomingEventProcessed(dedupKey);
      return;
    }

    await this.repo.upsertChatMapping({
      chatId: chat.id,
      externalUserId: externalUserId || `chat:${chat.id}`,
      bitrixChatId: bitrixChatId || String(chat.id),
      source,
    });

    this.outgoingSuppression.set(this.getOutboundSuppressionKey(chat.id, text), now);

    try {
      await this.dispatchToChat(chat.id, text, chat.channel, chat.organizationPhone, chat.telegramBot, chat);
    } catch (error) {
      await this.repo.unmarkIncomingEventProcessed(dedupKey);
      throw error;
    }
  }

  private parseIncomingPayload(payload: any): BitrixIncomingMessageContext | null {
    const text = String(
      payload?.data?.message?.text ||
        payload?.data?.messages?.[0]?.message?.text ||
        payload?.message?.text ||
        '',
    ).trim();

    if (!text) {
      return null;
    }

    const sourceRaw = String(
      payload?.data?.source || payload?.data?.chat?.source || payload?.source || 'WHATSAPP',
    ).toUpperCase();

    const source: ChatSource = sourceRaw === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP';

    const bitrixChatId =
      payload?.data?.chat?.id ||
      payload?.data?.messages?.[0]?.chat?.id ||
      payload?.chat?.id ||
      undefined;

    const externalUserId =
      payload?.data?.user?.id ||
      payload?.data?.messages?.[0]?.user?.id ||
      payload?.user?.id ||
      undefined;

    const externalMessageId =
      payload?.data?.message?.id ||
      payload?.data?.messages?.[0]?.message?.id ||
      payload?.message?.id ||
      undefined;

    const localChatIdCandidate = Number(bitrixChatId);

    return {
      text,
      source,
      bitrixChatId: bitrixChatId ? String(bitrixChatId) : undefined,
      externalUserId: externalUserId ? String(externalUserId) : undefined,
      externalMessageId: externalMessageId ? String(externalMessageId) : undefined,
      localChatIdCandidate: Number.isInteger(localChatIdCandidate) ? localChatIdCandidate : undefined,
    };
  }

  private getOutboundSuppressionKey(chatId: number, text: string): string {
    return `${chatId}:${text.trim().toLowerCase()}`;
  }

  private async dispatchToChat(
    chatId: number,
    text: string,
    channel: string,
    organizationPhone: any,
    telegramBot: any,
    chat: any,
  ): Promise<void> {
    if (channel === 'telegram') {
      if (!telegramBot?.id || !chat.telegramChatId) {
        throw new Error('Telegram binding missing');
      }
      await sendTelegramMessage(telegramBot.id, chat.telegramChatId, text, {});
      return;
    }

    if (channel === 'whatsapp') {
      if (!organizationPhone) {
        throw new Error('WhatsApp phone missing');
      }

      if (organizationPhone.connectionType === 'waba') {
        const waba = await createWABAService(organizationPhone.id);
        if (!waba) throw new Error('WABA service unavailable');
        const recipientPhone = (chat.remoteJid || '').replace('@s.whatsapp.net', '');
        await waba.sendTextMessage(recipientPhone, text);
        return;
      }

      const sock = getBaileysSock(organizationPhone.id);
      if (!sock || !sock.user) throw new Error('Baileys socket not ready');
      const normalizedReceiverJid = jidNormalizedUser(chat.remoteJid || '');
      if (!normalizedReceiverJid) throw new Error('Invalid remoteJid');
      await sendBaileysMessage(
        sock,
        normalizedReceiverJid,
        { text },
        chat.organizationId,
        organizationPhone.id,
        organizationPhone.phoneJid,
        undefined,
      );
      return;
    }

    throw new Error(`Unsupported channel ${channel}`);
  }

  private async rateLimit(): Promise<void> {
    const now = Date.now();
    const wait = this.lastCallTs + RATE_LIMIT_MS - now;
    if (wait > 0) {
      await new Promise((resolve) => setTimeout(resolve, wait));
    }
    this.lastCallTs = Date.now();
  }
}

export const bitrixConnectorService = new BitrixConnectorService();
