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
const BITRIX_WHATSAPP_LINE_ID =
  process.env.BITRIX_WHATSAPP_LINE_ID !== undefined ? process.env.BITRIX_WHATSAPP_LINE_ID : BITRIX_LINE_ID;
const BITRIX_TELEGRAM_LINE_ID =
  process.env.BITRIX_TELEGRAM_LINE_ID !== undefined ? process.env.BITRIX_TELEGRAM_LINE_ID : BITRIX_LINE_ID;
const BITRIX_WHATSAPP_CONNECTOR_CODE = process.env.BITRIX_WHATSAPP_CONNECTOR_CODE || 'whatsapp-db';
const BITRIX_TELEGRAM_CONNECTOR_CODE = process.env.BITRIX_TELEGRAM_CONNECTOR_CODE || 'telegram-db';
const BITRIX_APP_TOKEN = process.env.BITRIX_APP_TOKEN || '';
const BITRIX_FORCE_REMOTE_JID = String(process.env.BITRIX_FORCE_REMOTE_JID || '').trim();
const BITRIX_FORCE_ORGANIZATION_PHONE_ID = Number(process.env.BITRIX_FORCE_ORGANIZATION_PHONE_ID || 0);

const RATE_LIMIT_MS = Number(process.env.BITRIX_RATE_LIMIT_MS || 200);

export class BitrixConnectorService {
  private readonly client: AxiosInstance;
  private readonly repo = new BitrixRepository();
  private lastCallTs = 0;
  private readonly incomingSeen = new Map<string, number>();
  private readonly incomingTtlMs = 5 * 60 * 1000;
  private readonly outgoingSuppression = new Map<string, number>();
  // Keep anti-loop window short so manually typed WhatsApp messages are still mirrored to Bitrix.
  private readonly outgoingSuppressionTtlMs = Number(process.env.BITRIX_OUTGOING_SUPPRESSION_MS || 15000);
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

  private getRoutingForSource(source: ChatSource): { lineId: string | number; connectorCode: string } | null {
    if (source === 'TELEGRAM') {
      if (!BITRIX_TELEGRAM_LINE_ID) {
        return null;
      }

      return {
        lineId: Number(BITRIX_TELEGRAM_LINE_ID) || BITRIX_TELEGRAM_LINE_ID,
        connectorCode: BITRIX_TELEGRAM_CONNECTOR_CODE,
      };
    }

    if (!BITRIX_WHATSAPP_LINE_ID) {
      return null;
    }

    return {
      lineId: Number(BITRIX_WHATSAPP_LINE_ID) || BITRIX_WHATSAPP_LINE_ID,
      connectorCode: BITRIX_WHATSAPP_CONNECTOR_CODE,
    };
  }

  async sendToBitrix(messageId: number): Promise<void> {
    if (!BITRIX_WEBHOOK_URL) {
      logger.warn('[BitrixConnector] BITRIX_WEBHOOK_URL is not configured');
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
    const routing = this.getRoutingForSource(source);
    if (!routing) {
      this.logSkip('line_not_configured_for_source', { messageId, source, channel: message.channel });
      return;
    }

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
      CONNECTOR: routing.connectorCode,
      LINE: routing.lineId,
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
      if (this.shouldRetryWithRefresh(error)) {
        logger.warn(
          { messageId, status: error?.response?.status, response: error?.response?.data },
          '[BitrixConnector] Access token rejected, refreshing and retrying once',
        );

        try {
          const refreshedToken = await bitrixAuthService.refreshAccessToken();
          payload.auth = refreshedToken.accessToken;

          const { data } = await this.client.post('imconnector.send.messages', payload);
          logger.info(
            { messageId, durationMs: Date.now() - started, data },
            '[BitrixConnector] Sent to Bitrix after token refresh',
          );
          return;
        } catch (refreshRetryError: any) {
          logger.error(
            {
              messageId,
              status: refreshRetryError?.response?.status,
              response: refreshRetryError?.response?.data,
              message: refreshRetryError?.message,
            },
            '[BitrixConnector] Send failed after token refresh',
          );
          throw refreshRetryError;
        }
      }

      logger.error({ messageId, status: error?.response?.status, response: error?.response?.data }, '[BitrixConnector] Send failed');
      throw error;
    }
  }

  private shouldRetryWithRefresh(error: any): boolean {
    const status = Number(error?.response?.status || 0);
    const apiError = String(error?.response?.data?.error || '').toLowerCase();
    const apiDescription = String(error?.response?.data?.error_description || '').toLowerCase();

    if (status === 401) {
      return true;
    }

    return (
      apiError.includes('invalid_token') ||
      apiError.includes('expired_token') ||
      apiDescription.includes('invalid token') ||
      apiDescription.includes('expired token')
    );
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

    if (BITRIX_FORCE_REMOTE_JID) {
      const normalizedForcedJid = jidNormalizedUser(BITRIX_FORCE_REMOTE_JID);
      const forcedChat = await prisma.chat.findFirst({
        where: {
          channel: 'whatsapp',
          remoteJid: {
            in: [BITRIX_FORCE_REMOTE_JID, normalizedForcedJid].filter(Boolean),
          },
        },
        orderBy: { id: 'asc' },
      });

      if (forcedChat) {
        resolvedChatId = forcedChat.id;
        logger.info(
          {
            resolvedChatId,
            forcedRemoteJid: forcedChat.remoteJid,
            incomingBitrixChatId: bitrixChatId,
            incomingExternalUserId: externalUserId,
          },
          '[BitrixConnector] Forced chat routing applied',
        );
      } else {
        const forcedPhone =
          (Number.isInteger(BITRIX_FORCE_ORGANIZATION_PHONE_ID) && BITRIX_FORCE_ORGANIZATION_PHONE_ID > 0
            ? await prisma.organizationPhone.findUnique({ where: { id: BITRIX_FORCE_ORGANIZATION_PHONE_ID } })
            : null) ||
          (await prisma.organizationPhone.findFirst({
            where: { connectionType: 'baileys' },
            orderBy: [{ status: 'asc' }, { id: 'asc' }],
          }));

        if (!forcedPhone) {
          this.logSkip('forced_chat_phone_not_found', {
            forcedRemoteJid: BITRIX_FORCE_REMOTE_JID,
            forcedOrganizationPhoneId: BITRIX_FORCE_ORGANIZATION_PHONE_ID || null,
          });
          await this.repo.unmarkIncomingEventProcessed(dedupKey);
          return;
        }

        const createdChat = await prisma.chat.create({
          data: {
            organizationId: forcedPhone.organizationId,
            channel: 'whatsapp',
            remoteJid: normalizedForcedJid || BITRIX_FORCE_REMOTE_JID,
            receivingPhoneJid: forcedPhone.phoneJid,
            organizationPhoneId: forcedPhone.id,
            status: 'open',
          },
        });

        resolvedChatId = createdChat.id;
        logger.info(
          {
            resolvedChatId,
            forcedRemoteJid: createdChat.remoteJid,
            organizationPhoneId: forcedPhone.id,
            incomingBitrixChatId: bitrixChatId,
            incomingExternalUserId: externalUserId,
          },
          '[BitrixConnector] Forced chat created and routing applied',
        );
      }
    }

    if (!resolvedChatId && bitrixChatId) {
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
      externalUserId: this.getChatExternalUserId(chat, externalUserId),
      bitrixChatId: bitrixChatId || String(chat.id),
      source,
    });

    this.outgoingSuppression.set(this.getOutboundSuppressionKey(chat.id, text), now);

    try {
      await this.dispatchToChat(chat.id, text, chat.channel, chat.organizationPhone, chat.telegramBot, chat);
      await this.ackDeliveryToBitrix(parsed);
    } catch (error) {
      await this.repo.unmarkIncomingEventProcessed(dedupKey);
      throw error;
    }
  }

  private async ackDeliveryToBitrix(ctx: BitrixIncomingMessageContext): Promise<void> {
    if (!ctx.imChatId || !ctx.imMessageId || !ctx.bitrixChatId) {
      return;
    }

    if (!BITRIX_WEBHOOK_URL) {
      return;
    }

    const routing = this.getRoutingForSource(ctx.source);
    if (!routing) {
      return;
    }

    const payload: any = {
      CONNECTOR: routing.connectorCode,
      LINE: routing.lineId,
      MESSAGES: [
        {
          im: {
            chat_id: ctx.imChatId,
            message_id: ctx.imMessageId,
          },
          message: {
            id: [ctx.externalMessageId || String(ctx.imMessageId)],
          },
          chat: {
            id: ctx.bitrixChatId,
          },
        },
      ],
    };

    const authToken = await this.getAuthToken();
    if (authToken) {
      payload.auth = authToken;
    }

    try {
      await this.rateLimit();
      const { data } = await this.client.post('imconnector.send.status.delivery', payload);
      logger.info(
        { imChatId: ctx.imChatId, imMessageId: ctx.imMessageId, bitrixChatId: ctx.bitrixChatId, data },
        '[BitrixConnector] Delivery acknowledged in Bitrix',
      );
    } catch (error: any) {
      if (this.shouldRetryWithRefresh(error)) {
        logger.warn(
          {
            imChatId: ctx.imChatId,
            imMessageId: ctx.imMessageId,
            status: error?.response?.status,
            response: error?.response?.data,
          },
          '[BitrixConnector] Delivery ack token rejected, refreshing and retrying once',
        );

        try {
          const refreshedToken = await bitrixAuthService.refreshAccessToken();
          payload.auth = refreshedToken.accessToken;
          await this.rateLimit();
          const { data } = await this.client.post('imconnector.send.status.delivery', payload);
          logger.info(
            { imChatId: ctx.imChatId, imMessageId: ctx.imMessageId, bitrixChatId: ctx.bitrixChatId, data },
            '[BitrixConnector] Delivery acknowledged in Bitrix after token refresh',
          );
          return;
        } catch (refreshAckError: any) {
          logger.warn(
            {
              imChatId: ctx.imChatId,
              imMessageId: ctx.imMessageId,
              status: refreshAckError?.response?.status,
              response: refreshAckError?.response?.data,
            },
            '[BitrixConnector] Delivery acknowledgement failed after token refresh',
          );
          return;
        }
      }

      logger.warn(
        {
          imChatId: ctx.imChatId,
          imMessageId: ctx.imMessageId,
          status: error?.response?.status,
          response: error?.response?.data,
        },
        '[BitrixConnector] Delivery acknowledgement failed',
      );
    }
  }

  private parseIncomingPayload(payload: any): BitrixIncomingMessageContext | null {
    const eventName = String(payload?.event || payload?.EVENT || '').toUpperCase();
    if (eventName && eventName !== 'ONIMCONNECTORMESSAGEADD') {
      return null;
    }

    const firstMessage =
      payload?.data?.MESSAGES?.[0] ||
      payload?.data?.messages?.[0] ||
      payload?.MESSAGES?.[0] ||
      payload?.messages?.[0] ||
      null;

    const rawText = String(
      payload?.data?.message?.text ||
        payload?.data?.MESSAGE?.text ||
        payload?.data?.MESSAGES?.[0]?.message?.text ||
        payload?.data?.MESSAGES?.[0]?.MESSAGE?.text ||
        payload?.data?.messages?.[0]?.message?.text ||
        firstMessage?.message?.text ||
        firstMessage?.MESSAGE?.text ||
        payload?.message?.text ||
        payload?.MESSAGE?.text ||
        '',
    );

    const text = this.normalizeBitrixText(rawText).trim();

    if (!text) {
      return null;
    }

    const connectorCode = String(
      payload?.data?.CONNECTOR ||
        payload?.data?.connector ||
        payload?.CONNECTOR ||
        payload?.connector ||
        '',
    ).toLowerCase();

    const sourceRaw = String(
      payload?.data?.source ||
        payload?.data?.SOURCE ||
        payload?.data?.chat?.source ||
        payload?.data?.CHAT?.SOURCE ||
        payload?.source ||
        payload?.SOURCE ||
        (connectorCode.includes('telegram') ? 'TELEGRAM' : '') ||
        'WHATSAPP',
    ).toUpperCase();

    const source: ChatSource = sourceRaw === 'TELEGRAM' ? 'TELEGRAM' : 'WHATSAPP';

    const bitrixChatId =
      payload?.data?.chat?.id ||
      payload?.data?.CHAT?.ID ||
      payload?.data?.MESSAGES?.[0]?.chat?.id ||
      payload?.data?.MESSAGES?.[0]?.CHAT?.ID ||
      payload?.data?.chat?.id ||
      payload?.data?.messages?.[0]?.chat?.id ||
      firstMessage?.chat?.id ||
      firstMessage?.CHAT?.ID ||
      payload?.chat?.id ||
      payload?.CHAT?.ID ||
      undefined;

    const externalUserId =
      payload?.data?.user?.id ||
      payload?.data?.USER?.ID ||
      payload?.data?.MESSAGES?.[0]?.user?.id ||
      payload?.data?.MESSAGES?.[0]?.USER?.ID ||
      payload?.data?.user?.id ||
      payload?.data?.messages?.[0]?.user?.id ||
      firstMessage?.user?.id ||
      firstMessage?.USER?.ID ||
      payload?.user?.id ||
      payload?.USER?.ID ||
      undefined;

    const externalMessageId =
      payload?.data?.message?.id ||
      payload?.data?.MESSAGE?.id ||
      payload?.data?.MESSAGES?.[0]?.message?.id ||
      payload?.data?.MESSAGES?.[0]?.MESSAGE?.ID ||
      payload?.data?.message?.id ||
      payload?.data?.messages?.[0]?.message?.id ||
      firstMessage?.message?.id ||
      firstMessage?.MESSAGE?.ID ||
      payload?.message?.id ||
      payload?.MESSAGE?.ID ||
      undefined;

    const imChatIdRaw =
      payload?.data?.MESSAGES?.[0]?.im?.chat_id ||
      payload?.data?.MESSAGES?.[0]?.IM?.CHAT_ID ||
      payload?.data?.messages?.[0]?.im?.chat_id ||
      firstMessage?.im?.chat_id ||
      firstMessage?.IM?.CHAT_ID ||
      undefined;

    const imMessageIdRaw =
      payload?.data?.MESSAGES?.[0]?.im?.message_id ||
      payload?.data?.MESSAGES?.[0]?.IM?.MESSAGE_ID ||
      payload?.data?.messages?.[0]?.im?.message_id ||
      firstMessage?.im?.message_id ||
      firstMessage?.IM?.MESSAGE_ID ||
      undefined;

    const imChatId = Number(imChatIdRaw);
    const imMessageId = Number(imMessageIdRaw);

    const localChatIdCandidate = Number(bitrixChatId);

    return {
      text,
      source,
      bitrixChatId: bitrixChatId ? String(bitrixChatId) : undefined,
      externalUserId: externalUserId ? String(externalUserId) : undefined,
      externalMessageId: externalMessageId ? String(externalMessageId) : undefined,
      imChatId: Number.isFinite(imChatId) ? imChatId : undefined,
      imMessageId: Number.isFinite(imMessageId) ? imMessageId : undefined,
      localChatIdCandidate: Number.isInteger(localChatIdCandidate) ? localChatIdCandidate : undefined,
    };
  }

  private normalizeBitrixText(input: string): string {
    if (!input) {
      return '';
    }

    return input
      .replace(/\[br\]/gi, '\n')
      .replace(/\[(b|i|u|s)\]([\s\S]*?)\[\/\1\]/gi, '$2')
      .replace(/\[url\]([\s\S]*?)\[\/url\]/gi, '$1')
      .replace(/\[url=([\s\S]*?)\]([\s\S]*?)\[\/url\]/gi, '$2 ($1)')
      .replace(/\[img\]([\s\S]*?)\[\/img\]/gi, '$1')
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  private getOutboundSuppressionKey(chatId: number, text: string): string {
    return `${chatId}:${text.trim().toLowerCase()}`;
  }

  private isBaileysSocketReady(organizationPhoneId?: number | null): boolean {
    if (!organizationPhoneId) {
      return false;
    }

    const sock = getBaileysSock(organizationPhoneId);
    return Boolean(sock && sock.user);
  }

  private async resolveReadyWhatsappPhone(chat: any, currentPhone: any): Promise<any> {
    if (currentPhone?.connectionType === 'waba') {
      return currentPhone;
    }

    if (currentPhone?.id && this.isBaileysSocketReady(currentPhone.id)) {
      return currentPhone;
    }

    const candidates = await prisma.organizationPhone.findMany({
      where: {
        organizationId: chat.organizationId,
        connectionType: 'baileys',
        status: 'connected',
      },
      orderBy: [{ id: 'asc' }],
    });

    const fallbackPhone = candidates.find((phone) => this.isBaileysSocketReady(phone.id));
    if (!fallbackPhone) {
      return currentPhone;
    }

    if (chat.organizationPhoneId !== fallbackPhone.id || chat.receivingPhoneJid !== fallbackPhone.phoneJid) {
      await prisma.chat.update({
        where: { id: chat.id },
        data: {
          organizationPhoneId: fallbackPhone.id,
          receivingPhoneJid: fallbackPhone.phoneJid,
        },
      });

      logger.warn(
        {
          chatId: chat.id,
          previousOrganizationPhoneId: chat.organizationPhoneId,
          fallbackOrganizationPhoneId: fallbackPhone.id,
          fallbackPhoneJid: fallbackPhone.phoneJid,
        },
        '[BitrixConnector] Switched chat to ready Baileys phone',
      );
    }

    return fallbackPhone;
  }

  private buildOutboundWhatsAppJidCandidates(remoteJid: string | null | undefined): string[] {
    const normalized = jidNormalizedUser(remoteJid || '');
    if (!normalized) {
      return [];
    }

    const candidates = [normalized];

    if (!normalized.endsWith('@lid')) {
      return candidates;
    }

    const user = normalized.split('@')[0] || '';
    if (!/^\d+$/.test(user)) {
      return candidates;
    }

    candidates.push(`${user}@s.whatsapp.net`);
    return Array.from(new Set(candidates));
  }

  private async canSendToWhatsAppJid(sock: any, jid: string): Promise<boolean> {
    if (!jid || jid.endsWith('@lid')) {
      return Boolean(jid);
    }

    try {
      const verification = await sock.onWhatsApp(jid);
      return Array.isArray(verification)
        && verification.some((item) => String(item?.jid || '') === jid && Boolean(item?.exists));
    } catch (error) {
      logger.warn({ err: error, jid }, '[BitrixConnector] Failed to verify WhatsApp recipient');
      return false;
    }
  }

  private getChatExternalUserId(chat: any, fallbackExternalUserId?: string | null): string {
    if (chat?.channel === 'whatsapp') {
      return String(chat.remoteJid || fallbackExternalUserId || `chat:${chat.id}`);
    }

    return String(fallbackExternalUserId || `chat:${chat.id}`);
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
      const effectivePhone = await this.resolveReadyWhatsappPhone(chat, organizationPhone);
      if (!effectivePhone) {
        throw new Error('WhatsApp phone missing');
      }

      if (effectivePhone.connectionType === 'waba') {
        const waba = await createWABAService(effectivePhone.id);
        if (!waba) throw new Error('WABA service unavailable');
        const recipientPhone = (chat.remoteJid || '').replace('@s.whatsapp.net', '');
        await waba.sendTextMessage(recipientPhone, text);
        return;
      }

      const sock = getBaileysSock(effectivePhone.id);
      if (!sock || !sock.user) throw new Error('Baileys socket not ready');
      const originalRemoteJid = jidNormalizedUser(chat.remoteJid || '');
      const candidates = this.buildOutboundWhatsAppJidCandidates(chat.remoteJid || '');
      if (!candidates.length) throw new Error('Invalid remoteJid');

      let lastError: Error | null = null;

      for (const candidate of candidates) {
        const canSend = await this.canSendToWhatsAppJid(sock, candidate);
        if (!canSend) {
          lastError = new Error(`WhatsApp recipient not found: ${candidate}`);
          continue;
        }

        if (candidate !== originalRemoteJid) {
          logger.info(
            {
              chatId,
              originalRemoteJid: chat.remoteJid,
              resolvedRemoteJid: candidate,
            },
            '[BitrixConnector] Resolved outbound WhatsApp JID',
          );
        }

        try {
          await sendBaileysMessage(
            sock,
            candidate,
            { text },
            chat.organizationId,
            effectivePhone.id,
            effectivePhone.phoneJid,
            undefined,
          );

          if (candidate !== originalRemoteJid && candidate.endsWith('@s.whatsapp.net')) {
            await prisma.chat.update({
              where: { id: chat.id },
              data: { remoteJid: candidate },
            });
          }

          return;
        } catch (error: any) {
          lastError = error instanceof Error ? error : new Error(String(error));
          logger.warn(
            {
              chatId,
              candidate,
              message: error?.message,
            },
            '[BitrixConnector] Outbound WhatsApp send failed for candidate JID',
          );
        }
      }

      if (lastError) {
        throw lastError;
      }

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
