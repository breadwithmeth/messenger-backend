// src/controllers/wabaController.ts

import { Request, Response } from 'express';
import { createWABAService } from '../services/wabaService';
import { prisma } from '../config/authStorage';
import { ensureChat } from '../config/baileys';
import { createLogger } from '../config/logging';
import axios from 'axios';
import { chatVisibilityWhere, messageVisibilityWhere, userCanAccessHrChats } from '../auth/hrAccess';

const logger = createLogger();
const SENSITIVE_LOG_KEY = /(authorization|cookie|password|secret|token)/i;
const REDACTED_LOG_VALUE = '[REDACTED]';
const WABA_BROADCAST_SYNC_RECIPIENT_LIMIT = getPositiveIntegerEnv('WABA_BROADCAST_SYNC_RECIPIENT_LIMIT', 100);
const WABA_BROADCAST_JOB_TTL_MS = getPositiveIntegerEnv('WABA_BROADCAST_JOB_TTL_MS', 24 * 60 * 60 * 1000);

type WABAServiceInstance = NonNullable<Awaited<ReturnType<typeof createWABAService>>>;

type BroadcastJobStatus = 'queued' | 'running' | 'completed' | 'failed';

type BroadcastRecipientResult = {
  to: string;
  success: boolean;
  messageId?: string;
  error?: string;
};

type BroadcastTotals = {
  requested: number;
  normalized: number;
  processed: number;
  success: number;
  fail: number;
};

type BroadcastPayload = {
  organizationPhoneId: number;
  recipients: unknown[];
  normalizedRecipients: string[];
  templateName: string;
  language: string;
  components: any[];
  delayMs: number;
  dryRun: boolean;
};

type BroadcastContext = {
  organizationId: number;
  userId?: number;
  canAccessHrChats: boolean;
};

type BroadcastExecutionResult = {
  success: boolean;
  dryRun: boolean;
  organizationPhoneId: number;
  templateName: string;
  language: string;
  delayMs: number;
  totals: BroadcastTotals;
  results: BroadcastRecipientResult[];
};

type BroadcastJob = BroadcastExecutionResult & {
  id: string;
  status: BroadcastJobStatus;
  organizationId: number;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  error?: string;
};

const broadcastJobs = new Map<string, BroadcastJob>();

function getPositiveIntegerEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(String(process.env[name] || ''), 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return fallback;
}

function parseDelayMs(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0) return 250;
  return Math.min(Math.floor(parsed), 60_000);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function createBroadcastJobId(): string {
  return `waba_broadcast_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function cleanupBroadcastJobs() {
  const now = Date.now();

  for (const [jobId, job] of broadcastJobs.entries()) {
    if (!['completed', 'failed'].includes(job.status)) continue;
    if (now - Date.parse(job.updatedAt) > WABA_BROADCAST_JOB_TTL_MS) {
      broadcastJobs.delete(jobId);
    }
  }
}

function normalizePhone(value: unknown): string | null {
  const digits = String(value ?? '').replace(/\D/g, '');
  return digits.length > 0 ? digits : null;
}

function buildWabaPhoneJid(displayPhoneNumber: unknown, phoneNumberId: string): string {
  const displayDigits = normalizePhone(displayPhoneNumber);
  return `${displayDigits || phoneNumberId}@s.whatsapp.net`;
}

async function canAccessExistingWabaChat(
  organizationId: number,
  organizationPhoneId: number,
  remoteJid: string,
  canAccessHrChats: boolean
): Promise<boolean> {
  const existingChat = await prisma.chat.findFirst({
    where: {
      organizationId,
      organizationPhoneId,
      remoteJid,
    },
    select: {
      isHr: true,
    },
  });

  return !existingChat?.isHr || canAccessHrChats;
}

function getBroadcastErrorMessage(error: any): string {
  return error?.response?.data?.error?.message || error?.message || 'Unknown error';
}

async function sendBroadcastTemplateRecipient(args: {
  to: string;
  orgPhone: any;
  payload: BroadcastPayload;
  context: BroadcastContext;
  wabaService: WABAServiceInstance | null;
}): Promise<BroadcastRecipientResult> {
  const { to, orgPhone, payload, context, wabaService } = args;
  const remoteJid = `${to}@s.whatsapp.net`;

  try {
    const canAccessChat = await canAccessExistingWabaChat(
      orgPhone.organizationId,
      orgPhone.id,
      remoteJid,
      context.canAccessHrChats
    );

    if (!canAccessChat) {
      return { to, success: false, error: 'Chat not found' };
    }

    if (!payload.dryRun && wabaService) {
      const sendResult = await wabaService.sendTemplateMessage(
        to,
        payload.templateName,
        payload.language,
        payload.components
      );

      const messageId = sendResult?.messages?.[0]?.id;

      const chatId = await ensureChat(
        orgPhone.organizationId,
        orgPhone.id,
        orgPhone.phoneJid,
        remoteJid,
        undefined,
        { reopenClosedTicket: false }
      );
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
        select: { isHr: true },
      });

      await prisma.message.create({
        data: {
          chatId,
          organizationPhoneId: orgPhone.id,
          organizationId: orgPhone.organizationId,
          channel: 'whatsapp',
          whatsappMessageId: messageId,
          receivingPhoneJid: orgPhone.phoneJid,
          remoteJid,
          senderJid: orgPhone.phoneJid,
          fromMe: true,
          content: `Template: ${payload.templateName}`,
          type: 'template',
          timestamp: new Date(),
          status: 'sent',
          senderUserId: context.userId,
          isReadByOperator: true,
          isHr: chat?.isHr === true,
        },
      });

      return { to, success: true, messageId };
    }

    return { to, success: true };
  } catch (error: any) {
    return { to, success: false, error: getBroadcastErrorMessage(error) };
  }
}

async function executeBroadcastTemplate(args: {
  orgPhone: any;
  payload: BroadcastPayload;
  context: BroadcastContext;
  wabaService: WABAServiceInstance | null;
  onResult?: (result: BroadcastRecipientResult, totals: BroadcastTotals) => void;
}): Promise<BroadcastExecutionResult> {
  const { orgPhone, payload, context, wabaService, onResult } = args;
  const results: BroadcastRecipientResult[] = [];
  const totals: BroadcastTotals = {
    requested: payload.recipients.length,
    normalized: payload.normalizedRecipients.length,
    processed: 0,
    success: 0,
    fail: 0,
  };

  for (let idx = 0; idx < payload.normalizedRecipients.length; idx++) {
    const result = await sendBroadcastTemplateRecipient({
      to: payload.normalizedRecipients[idx],
      orgPhone,
      payload,
      context,
      wabaService,
    });

    results.push(result);
    totals.processed = results.length;
    if (result.success) {
      totals.success += 1;
    } else {
      totals.fail += 1;
    }
    onResult?.(result, { ...totals });

    if (idx < payload.normalizedRecipients.length - 1 && payload.delayMs > 0) {
      await sleep(payload.delayMs);
    }
  }

  return {
    success: totals.fail === 0,
    dryRun: payload.dryRun,
    organizationPhoneId: payload.organizationPhoneId,
    templateName: payload.templateName,
    language: payload.language,
    delayMs: payload.delayMs,
    totals,
    results,
  };
}

function startBroadcastTemplateJob(args: {
  orgPhone: any;
  payload: BroadcastPayload;
  context: BroadcastContext;
  wabaService: WABAServiceInstance | null;
}): BroadcastJob {
  cleanupBroadcastJobs();

  const { orgPhone, payload, context, wabaService } = args;
  const now = new Date().toISOString();
  const job: BroadcastJob = {
    id: createBroadcastJobId(),
    status: 'queued',
    organizationId: context.organizationId,
    createdAt: now,
    updatedAt: now,
    success: false,
    dryRun: payload.dryRun,
    organizationPhoneId: payload.organizationPhoneId,
    templateName: payload.templateName,
    language: payload.language,
    delayMs: payload.delayMs,
    totals: {
      requested: payload.recipients.length,
      normalized: payload.normalizedRecipients.length,
      processed: 0,
      success: 0,
      fail: 0,
    },
    results: [],
  };

  broadcastJobs.set(job.id, job);

  void (async () => {
    job.status = 'running';
    job.startedAt = new Date().toISOString();
    job.updatedAt = job.startedAt;

    try {
      const result = await executeBroadcastTemplate({
        orgPhone,
        payload,
        context,
        wabaService,
        onResult: (recipientResult, totals) => {
          job.results.push(recipientResult);
          job.totals = totals;
          job.updatedAt = new Date().toISOString();
        },
      });

      job.status = 'completed';
      job.success = result.success;
      job.totals = result.totals;
      job.results = result.results;
    } catch (error: any) {
      job.status = 'failed';
      job.success = false;
      job.error = getBroadcastErrorMessage(error);
    } finally {
      job.completedAt = new Date().toISOString();
      job.updatedAt = job.completedAt;
    }
  })();

  return job;
}

function redactForConsoleLog(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactForConsoleLog(item));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, childValue]) => [
      key,
      SENSITIVE_LOG_KEY.test(key) ? REDACTED_LOG_VALUE : redactForConsoleLog(childValue),
    ])
  );
}

function logWabaWebhookRequest(req: Request, body: unknown = req.body) {
  try {
    console.log('[WABA WEBHOOK REQUEST]', JSON.stringify({
      timestamp: new Date().toISOString(),
      method: req.method,
      url: `${req.baseUrl}${req.path}`,
      query: redactForConsoleLog(req.query),
      headers: redactForConsoleLog(req.headers),
      body: redactForConsoleLog(body),
    }, null, 2));
  } catch (error) {
    console.log('[WABA WEBHOOK REQUEST LOG ERROR]', String(error));
  }
}

function getQueryString(req: Request, dottedKey: string, underscoredKey: string): string {
  const value = req.query[dottedKey] ?? req.query[underscoredKey];
  return Array.isArray(value) ? String(value[0] ?? '') : String(value ?? '');
}

function getGraphErrorSnapshot(error: any): Record<string, unknown> {
  const responseData = error?.response?.data;
  const graphError = responseData?.error;

  return {
    message: graphError?.message || error?.message,
    code: graphError?.code,
    subcode: graphError?.error_subcode,
    type: graphError?.type,
    fbtraceId: graphError?.fbtrace_id,
    isTransient: graphError?.is_transient,
    responseStatus: error?.response?.status,
    responseStatusText: error?.response?.statusText,
    responseData: redactForConsoleLog(responseData),
  };
}

async function ensureDefaultOrganization() {
  let organization = await prisma.organization.findFirst();

  if (!organization) {
    organization = await prisma.organization.create({
      data: {
        name: 'Default Organization',
      },
    });
    console.log('[WABA PHONE AUTO-ADD]', JSON.stringify({
      status: 'created_default_organization',
      organizationId: organization.id,
    }));
  }

  return organization;
}

async function ensureWabaOrganizationPhone(value: any) {
  const phoneNumberId = String(value?.metadata?.phone_number_id || '').trim();
  const displayPhoneNumber = value?.metadata?.display_phone_number;

  if (!phoneNumberId) {
    console.log('[WABA PHONE AUTO-ADD]', JSON.stringify({
      status: 'skipped',
      reason: 'missing_phone_number_id',
    }));
    return null;
  }

  const phoneJid = buildWabaPhoneJid(displayPhoneNumber, phoneNumberId);
  const displayName = `WABA ${displayPhoneNumber || phoneNumberId}`;

  let orgPhone = await prisma.organizationPhone.findFirst({
    where: {
      OR: [
        { wabaPhoneNumberId: phoneNumberId },
        { phoneJid },
      ],
    },
  });

  if (orgPhone) {
    const updateData: Record<string, unknown> = {
      status: 'connected',
      connectionType: 'waba',
      wabaPhoneNumberId: phoneNumberId,
      lastConnectedAt: new Date(),
    };

    if (!orgPhone.displayName || orgPhone.displayName.startsWith('WABA ')) {
      updateData.displayName = displayName;
    }
    if (orgPhone.phoneJid !== phoneJid) {
      updateData.phoneJid = phoneJid;
    }
    if (!orgPhone.wabaAccessToken && process.env.WABA_ACCESS_TOKEN) {
      updateData.wabaAccessToken = process.env.WABA_ACCESS_TOKEN;
    }
    if (!orgPhone.wabaId && process.env.WABA_ID) {
      updateData.wabaId = process.env.WABA_ID;
    }
    if (!orgPhone.wabaApiVersion) {
      updateData.wabaApiVersion = 'v21.0';
    }
    if (!orgPhone.wabaVerifyToken && process.env.WABA_VERIFY_TOKEN) {
      updateData.wabaVerifyToken = process.env.WABA_VERIFY_TOKEN;
    }

    orgPhone = await prisma.organizationPhone.update({
      where: { id: orgPhone.id },
      data: updateData,
    });

    console.log('[WABA PHONE AUTO-ADD]', JSON.stringify({
      status: 'updated',
      organizationPhoneId: orgPhone.id,
      phoneNumberId,
      phoneJid: orgPhone.phoneJid,
    }));
    return orgPhone;
  }

  const organization = await ensureDefaultOrganization();
  let autoAddStatus = 'created';

  try {
    orgPhone = await prisma.organizationPhone.create({
      data: {
        organizationId: organization.id,
        displayName,
        phoneJid,
        status: 'connected',
        connectionType: 'waba',
        wabaPhoneNumberId: phoneNumberId,
        wabaAccessToken: process.env.WABA_ACCESS_TOKEN || null,
        wabaId: process.env.WABA_ID || null,
        wabaApiVersion: 'v21.0',
        wabaVerifyToken: process.env.WABA_VERIFY_TOKEN || null,
        lastConnectedAt: new Date(),
      },
    });
  } catch (error: any) {
    if (error?.code !== 'P2002') throw error;
    autoAddStatus = 'updated_after_conflict';

    orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        OR: [
          { wabaPhoneNumberId: phoneNumberId },
          { phoneJid },
        ],
      },
    });
    if (!orgPhone) throw error;

    orgPhone = await prisma.organizationPhone.update({
      where: { id: orgPhone.id },
      data: {
        displayName,
        phoneJid,
        status: 'connected',
        connectionType: 'waba',
        wabaPhoneNumberId: phoneNumberId,
        wabaAccessToken: orgPhone.wabaAccessToken || process.env.WABA_ACCESS_TOKEN || null,
        wabaId: orgPhone.wabaId || process.env.WABA_ID || null,
        wabaApiVersion: orgPhone.wabaApiVersion || 'v21.0',
        wabaVerifyToken: orgPhone.wabaVerifyToken || process.env.WABA_VERIFY_TOKEN || null,
        lastConnectedAt: new Date(),
      },
    });
  }

  console.log('[WABA PHONE AUTO-ADD]', JSON.stringify({
    status: autoAddStatus,
    organizationPhoneId: orgPhone.id,
    organizationId: orgPhone.organizationId,
    phoneNumberId,
    phoneJid: orgPhone.phoneJid,
  }));

  return orgPhone;
}

/**
 * Webhook verification для WhatsApp Business API
 * GET /api/waba/webhook
 */
export const verifyWebhook = async (req: Request, res: Response) => {
  try {
    const mode = getQueryString(req, 'hub.mode', 'hub_mode');
    const token = getQueryString(req, 'hub.verify_token', 'hub_verify_token').trim();
    const challenge = getQueryString(req, 'hub.challenge', 'hub_challenge');

    logWabaWebhookRequest(req);

    logger.info('🔍 WABA: Webhook verification request', {
      mode,
      receivedToken: token ? REDACTED_LOG_VALUE : '',
      challenge,
      hasEnvVerifyToken: Boolean(process.env.WABA_VERIFY_TOKEN),
    });

    if (mode !== 'subscribe' || !token || !challenge) {
      logger.warn('⚠️ WABA: Webhook verification failed: missing mode, token, or challenge', {
        mode,
        hasToken: Boolean(token),
        hasChallenge: Boolean(challenge),
      });
      console.log('[WABA WEBHOOK VERIFY]', JSON.stringify({
        status: 'failed',
        reason: 'missing_or_invalid_query',
        mode,
        hasToken: Boolean(token),
        hasChallenge: Boolean(challenge),
      }));
      return res.sendStatus(403);
    }

    if (token === String(process.env.WABA_VERIFY_TOKEN || '').trim()) {
      console.log('[WABA WEBHOOK VERIFY]', JSON.stringify({
        status: 'success',
        source: 'env',
        challenge,
      }));
      return res.status(200).send(challenge);
    }

    const matchedOrgPhone = await prisma.organizationPhone.findFirst({
      where: {
        wabaVerifyToken: token,
      },
      select: {
        id: true,
        phoneJid: true,
        wabaPhoneNumberId: true,
      },
    });

    const isValidToken = Boolean(matchedOrgPhone);

    if (isValidToken) {
      logger.info('✅ WABA: Webhook verification successful', {
        matchedOrgPhoneId: matchedOrgPhone?.id,
        phoneJid: matchedOrgPhone?.phoneJid,
        wabaPhoneNumberId: matchedOrgPhone?.wabaPhoneNumberId,
      });
      console.log('[WABA WEBHOOK VERIFY]', JSON.stringify({
        status: 'success',
        source: 'database',
        matchedOrgPhoneId: matchedOrgPhone?.id,
        challenge,
      }));
      return res.status(200).send(challenge);
    } else {
      logger.warn('⚠️ WABA: Webhook verification failed', {
        tokenMatch: false,
      });
      console.log('[WABA WEBHOOK VERIFY]', JSON.stringify({
        status: 'failed',
        reason: 'token_mismatch',
        hasEnvVerifyToken: Boolean(process.env.WABA_VERIFY_TOKEN),
      }));
      return res.sendStatus(403);
    }
  } catch (error) {
    logger.error('❌ WABA: Webhook verification error:', error);
    console.log('[WABA WEBHOOK VERIFY]', JSON.stringify({
      status: 'failed',
      reason: 'server_error',
      error: error instanceof Error ? error.message : String(error),
    }));
    return res.sendStatus(500);
  }
};

/**
 * Обработка входящих webhook событий от WhatsApp Business API
 * POST /api/waba/webhook
 */
export const handleWebhook = async (req: Request, res: Response) => {
  try {
    const body = req.body;

    logWabaWebhookRequest(req, body);

    // Meta требует быстрый 200 OK. Все обращения к БД и обработку делаем после ACK.
    res.sendStatus(200);
    console.log('[WABA WEBHOOK ACK]', JSON.stringify({
      status: 'accepted',
      object: body?.object,
      entryCount: Array.isArray(body?.entry) ? body.entry.length : 0,
    }));

    // Сохраняем сырый payload в логи WABA (не блокируем ответ)
    try {
      await (prisma as any).wabaWebhookLog.create({
        data: {
          payload: body,
          eventType: 'webhook',
        },
      });
    } catch (logErr) {
      logger.warn('⚠️ WABA: Failed to persist webhook log', { err: String(logErr) });
    }

    // Лог в консоль: короткая структурированная информация о приходящем webhook
    try {
      const entryCount = Array.isArray(body.entry) ? body.entry.length : 0;
      const phoneIds: string[] = [];
      if (Array.isArray(body.entry)) {
        for (const entry of body.entry) {
          if (Array.isArray(entry.changes)) {
            for (const ch of entry.changes) {
              const id = ch?.value?.metadata?.phone_number_id;
              if (id) phoneIds.push(String(id));
            }
          }
        }
      }
      logger.info('📬 WABA: Incoming webhook', { object: body.object, entryCount, phoneNumberIds: phoneIds });
    } catch (logErr) {
      logger.warn('⚠️ WABA: Failed to log incoming webhook to console', { err: String(logErr) });
    }

    // Обрабатываем webhook асинхронно
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry) {
        for (const change of entry.changes) {
          await processWebhookChange(change);
        }
      }
    }
  } catch (error) {
    logger.error('❌ WABA: Webhook processing error:', error);
  }
};

/**
 * Обработка изменений из webhook
 */
async function processWebhookChange(change: any) {
  try {
    const value = change.value;
    if (!value) return;

    const phoneNumberId = String(value.metadata?.phone_number_id || '').trim();
    const displayPhoneNumber = value.metadata?.display_phone_number;
    const orgPhone = await ensureWabaOrganizationPhone(value);
    if (!orgPhone) return;

    // Лог в консоль по обработке change
    try {
      logger.info('🔔 WABA: Processing change', {
        phoneNumberId,
        displayPhoneNumber,
        eventType: value.messages ? 'messages' : value.statuses ? 'message_status' : 'unknown',
        messagesCount: value.messages ? value.messages.length : 0,
        statusesCount: value.statuses ? value.statuses.length : 0,
      });
    } catch (logErr) {
      logger.warn('⚠️ WABA: Failed to write change log to console', { err: String(logErr) });
    }

    // Сохраняем более детальную запись лога с привязкой к OrganizationPhone
    try {
      await (prisma as any).wabaWebhookLog.create({
        data: {
          organizationPhoneId: orgPhone.id,
          phoneNumberId: phoneNumberId,
          eventType: value.messages ? 'messages' : value.statuses ? 'message_status' : 'unknown',
          payload: value,
        },
      });
    } catch (logErr) {
      logger.warn('⚠️ WABA: Failed to persist detailed webhook log', { err: String(logErr) });
    }

    // Обработка статусов сообщений
    if (value.statuses) {
      for (const status of value.statuses) {
        await handleMessageStatus(orgPhone.id, status);
      }
    }

    // Обработка входящих сообщений
    if (value.messages) {
      const contacts = value.contacts || [];
      for (const message of value.messages) {
        // Находим контакт отправителя
        const contact = contacts.find((c: any) => c.wa_id === message.from);
        await handleIncomingMessage(orgPhone, message, contact);
      }
    }
  } catch (error) {
    logger.error('❌ WABA: Change processing error:', error);
  }
}

/**
 * Обработка статуса сообщения (delivered, read, etc.)
 */
async function handleMessageStatus(organizationPhoneId: number, status: any) {
  try {
    const wabaMessageId = status.id;
    const newStatus = status.status; // sent, delivered, read, failed

    await prisma.message.updateMany({
      where: {
        whatsappMessageId: wabaMessageId,
        organizationPhoneId,
      },
      data: {
        status: newStatus,
      },
    });

    logger.info(`📊 WABA: Message ${wabaMessageId} status updated to ${newStatus}`);
  } catch (error) {
    logger.error('❌ WABA: Status update error:', error);
  }
}

/**
 * Обработка входящего сообщения
 */
async function handleIncomingMessage(orgPhone: any, message: any, contact?: any) {
  try {
    // Нормализуем номер в формат WhatsApp JID
    const phoneNumber = message.from;
    const remoteJid = phoneNumber.includes('@') ? phoneNumber : `${phoneNumber}@s.whatsapp.net`;
    const wabaMessageId = message.id;
    const timestamp = new Date(parseInt(message.timestamp) * 1000);
    
    // Извлекаем имя из контакта
    const contactName = contact?.profile?.name || undefined;

    // Определяем тип сообщения и контент
    let content = '';
    let messageType = 'text';
    let mediaUrl: string | undefined;
    let filename: string | undefined;
    let mimeType: string | undefined;
    let quotedMessageId: string | undefined;
    let quotedContent: string | undefined;

    // --- ОБРАБОТКА ОТВЕТА В WABA (общая для всех типов) ---
    // В WABA структура реплая: message.context = { from: "...", id: "wamid..." }
    if (message.context?.id) {
      quotedMessageId = message.context.id;
      
      // Пытаемся найти цитируемое сообщение в БД
      const quotedDbMsg = await prisma.message.findFirst({
        where: {
          whatsappMessageId: quotedMessageId,
          organizationPhoneId: orgPhone.id,
        },
        select: { content: true, type: true, mediaUrl: true },
      });
      
      if (quotedDbMsg) {
        // Извлекаем контент в зависимости от типа
        if (quotedDbMsg.type === 'text') {
          quotedContent = quotedDbMsg.content;
        } else if (quotedDbMsg.type === 'image') {
          quotedContent = quotedDbMsg.content || '[Изображение]';
        } else if (quotedDbMsg.type === 'video') {
          quotedContent = quotedDbMsg.content || '[Видео]';
        } else if (quotedDbMsg.type === 'document') {
          quotedContent = quotedDbMsg.content || '[Документ]';
        } else if (quotedDbMsg.type === 'audio') {
          quotedContent = '[Аудио]';
        } else {
          quotedContent = `[${quotedDbMsg.type}]`;
        }
      } else {
        quotedContent = '[Сообщение не найдено]';
      }
      
      logger.info(`  [reply] Ответ на сообщение ID: ${quotedMessageId}, текст: "${quotedContent}"`);
    }
    // --- КОНЕЦ: ОБРАБОТКА ОТВЕТА В WABA ---

    if (message.type === 'text') {
      content = message.text?.body || '';
      messageType = 'text';
    } else if (message.type === 'image') {
      content = message.image?.caption || '';
      messageType = 'image';
      mimeType = message.image?.mime_type;
      
      // Скачиваем изображение с серверов WhatsApp и загружаем на R2
      if (message.image?.id) {
        const wabaService = await createWABAService(orgPhone.id);
        if (wabaService) {
          try {
            mediaUrl = await wabaService.downloadAndUploadMedia(message.image.id, mimeType);
            logger.info(`✅ WABA: Изображение загружено на R2: ${mediaUrl}`);
          } catch (error) {
            logger.error('❌ WABA: Ошибка загрузки изображения:', error);
          }
        }
      }
    } else if (message.type === 'document') {
      content = message.document?.caption || '';
      messageType = 'document';
      filename = message.document?.filename;
      mimeType = message.document?.mime_type;
      
      // Скачиваем документ с серверов WhatsApp и загружаем на R2
      if (message.document?.id) {
        const wabaService = await createWABAService(orgPhone.id);
        if (wabaService) {
          try {
            mediaUrl = await wabaService.downloadAndUploadMedia(message.document.id, mimeType);
            logger.info(`✅ WABA: Документ загружен на R2: ${mediaUrl}`);
          } catch (error) {
            logger.error('❌ WABA: Ошибка загрузки документа:', error);
          }
        }
      }
    } else if (message.type === 'audio') {
      messageType = 'audio';
      mimeType = message.audio?.mime_type;
      
      // Скачиваем аудио с серверов WhatsApp и загружаем на R2
      if (message.audio?.id) {
        const wabaService = await createWABAService(orgPhone.id);
        if (wabaService) {
          try {
            mediaUrl = await wabaService.downloadAndUploadMedia(message.audio.id, mimeType);
            logger.info(`✅ WABA: Аудио загружено на R2: ${mediaUrl}`);
          } catch (error) {
            logger.error('❌ WABA: Ошибка загрузки аудио:', error);
          }
        }
      }
    } else if (message.type === 'video') {
      content = message.video?.caption || '';
      messageType = 'video';
      mimeType = message.video?.mime_type;
      
      // Скачиваем видео с серверов WhatsApp и загружаем на R2
      if (message.video?.id) {
        const wabaService = await createWABAService(orgPhone.id);
        if (wabaService) {
          try {
            mediaUrl = await wabaService.downloadAndUploadMedia(message.video.id, mimeType);
            logger.info(`✅ WABA: Видео загружено на R2: ${mediaUrl}`);
          } catch (error) {
            logger.error('❌ WABA: Ошибка загрузки видео:', error);
          }
        }
      }
    } else if (message.type === 'button') {
      content = message.button?.text || '';
      messageType = 'button';
    } else if (message.type === 'interactive') {
      if (message.interactive?.type === 'button_reply') {
        content = message.interactive.button_reply.title;
        messageType = 'interactive_button';
      } else if (message.interactive?.type === 'list_reply') {
        content = message.interactive.list_reply.title;
        messageType = 'interactive_list';
      }
    } else if (message.type === 'location') {
      // Обработка геолокации
      messageType = 'location';
      const location = message.location;
      
      // Формируем красивое текстовое представление геолокации
      const locationParts = [];
      if (location.name) locationParts.push(location.name);
      if (location.address && location.address !== location.name) locationParts.push(location.address);
      
      const locationText = locationParts.length > 0 
        ? locationParts.join(', ') 
        : 'Геолокация';
      
      // Создаем Google Maps ссылку для удобства
      const mapsUrl = `https://www.google.com/maps?q=${location.latitude},${location.longitude}`;
      
      content = `📍 ${locationText}\nКоординаты: ${location.latitude}, ${location.longitude}\nКарта: ${mapsUrl}`;

      logger.info(`📍 WABA: Геолокация получена: ${locationText} (${location.latitude}, ${location.longitude})`);
    }

    // Добавляем информацию о реплае к контенту (после обработки всех типов сообщений)
    if (quotedContent) {
      const replyText = `ответил на: "${quotedContent}"`;
      if (content) {
        content = `${replyText}\n\n${content}`;
      } else {
        content = replyText;
      }
    }

    // Логируем входящее сообщение
    logger.info(`📥 WABA: Входящее [${messageType}]: "${content}" от ${remoteJid} (${contactName || 'Unknown'})`);

    // Создаём или находим чат
    const chatId = await ensureChat(
      orgPhone.organizationId,
      orgPhone.id,
      orgPhone.phoneJid,
      remoteJid,
      contactName
    );

    const chatAssignment = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { assignedUserId: true, isHr: true },
    });
    const hasResponsible = Boolean(chatAssignment?.assignedUserId);

    // Сохраняем сообщение в БД
    const savedMessage = await prisma.message.create({
      data: {
        chatId,
        organizationPhoneId: orgPhone.id,
        organizationId: orgPhone.organizationId,
        channel: 'whatsapp',
        whatsappMessageId: wabaMessageId,
        receivingPhoneJid: orgPhone.phoneJid,
        remoteJid,
        senderJid: remoteJid,
        fromMe: false,
        content,
        type: messageType,
        mediaUrl,
        filename,
        mimeType,
        timestamp,
        status: 'received',
        isReadByOperator: false,
        isHr: chatAssignment?.isHr === true,
        // --- СОХРАНЕНИЕ ДАННЫХ ОТВЕТОВ ---
        quotedMessageId: quotedMessageId,
        quotedContent: quotedContent,
      },
    });

    // Увеличиваем счётчик непрочитанных
    await prisma.chat.update({
      where: { id: chatId },
      data: {
        unreadCount: { increment: 1 },
        lastMessageAt: timestamp,
      },
    });

    logger.info(`💾 WABA: Message saved to DB (chatId: ${chatId})`);

    // Отправляем Socket.IO уведомление о новом сообщении
    const { notifyNewMessage } = await import('../services/socketService');
    try {
      notifyNewMessage(orgPhone.organizationId, {
        id: savedMessage.id,
        chatId: savedMessage.chatId,
        content: savedMessage.content,
        type: savedMessage.type,
        mediaUrl: savedMessage.mediaUrl,
        filename: savedMessage.filename,
        fromMe: savedMessage.fromMe,
        timestamp: savedMessage.timestamp,
        status: savedMessage.status,
        senderJid: savedMessage.senderJid,
        channel: 'whatsapp',
        hasResponsible,
      });
    } catch (socketError) {
      logger.error('[Socket.IO] Ошибка отправки уведомления WABA:', socketError);
    }
  } catch (error) {
    logger.error('❌ WABA: Incoming message processing error:', error);
  }
}

/**
 * Отправка сообщения через WABA
 * POST /api/waba/send
 */
export const sendMessage = async (req: Request, res: Response) => {
  try {
    const { organizationPhoneId, to, message, type = 'text' } = req.body;
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    if (!organizationPhoneId || !to || !message) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Проверяем права доступа
    const orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        id: organizationPhoneId,
        organizationId: res.locals.organizationId,
        connectionType: 'waba',
      },
    });

    if (!orgPhone) {
      return res.status(404).json({ error: 'Organization phone not found or not configured for WABA' });
    }

    const remoteJid = to.includes('@') ? to : `${to}@s.whatsapp.net`;
    const canAccessChat = await canAccessExistingWabaChat(
      orgPhone.organizationId,
      orgPhone.id,
      remoteJid,
      canAccessHrChats
    );

    if (!canAccessChat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const wabaService = await createWABAService(organizationPhoneId);
    if (!wabaService) {
      return res.status(500).json({ 
        error: 'WABA service not configured',
        details: 'wabaAccessToken is missing in database. Please update OrganizationPhone with your permanent System User Access Token from Meta.',
        organizationPhoneId: organizationPhoneId
      });
    }

    // Отправляем сообщение
    let result;
    let messageContent = '';
    let mediaUrl: string | null = null;
    
    switch (type) {
      case 'text':
        result = await wabaService.sendTextMessage(to, message);
        messageContent = message;
        break;
        
      case 'image':
        if (!message.link) {
          return res.status(400).json({ error: 'image.link is required' });
        }
        result = await wabaService.sendImage(to, message.link, message.caption);
        messageContent = message.caption || '';
        mediaUrl = message.link;
        break;
        
      case 'document':
        if (!message.link) {
          return res.status(400).json({ error: 'document.link is required' });
        }
        result = await wabaService.sendDocument(to, message.link, message.filename, message.caption);
        messageContent = message.caption || message.filename || '';
        mediaUrl = message.link;
        break;
        
      case 'video':
        if (!message.link) {
          return res.status(400).json({ error: 'video.link is required' });
        }
        result = await wabaService.sendMessage({
          to,
          type: 'video',
          video: {
            link: message.link,
            caption: message.caption,
          },
        });
        messageContent = message.caption || '';
        mediaUrl = message.link;
        break;
        
      case 'audio':
        if (!message.link) {
          return res.status(400).json({ error: 'audio.link is required' });
        }
        result = await wabaService.sendMessage({
          to,
          type: 'audio',
          audio: {
            link: message.link,
          },
        });
        messageContent = 'Audio message';
        mediaUrl = message.link;
        break;
        
      case 'interactive':
        result = await wabaService.sendMessage({
          to,
          type: 'interactive',
          interactive: message,
        });
        messageContent = message.body?.text || JSON.stringify(message);
        break;
        
      case 'template':
        result = await wabaService.sendTemplateMessage(to, message.name, message.language, message.components);
        messageContent = `Template: ${message.name}`;
        break;
        
      default:
        return res.status(400).json({ error: `Unsupported message type: ${type}. Supported: text, image, document, video, audio, interactive, template` });
    }

    // Сохраняем отправленное сообщение в БД
    const chatId = await ensureChat(
      orgPhone.organizationId,
      orgPhone.id,
      orgPhone.phoneJid,
      remoteJid,
      undefined,
      { reopenClosedTicket: false }
    );
    const chat = await prisma.chat.findUnique({
      where: { id: chatId },
      select: { isHr: true },
    });

    await prisma.message.create({
      data: {
        chatId,
        organizationPhoneId,
        organizationId: orgPhone.organizationId,
        channel: 'whatsapp',
        whatsappMessageId: result.messages?.[0]?.id,
        receivingPhoneJid: orgPhone.phoneJid,
        remoteJid: remoteJid,
        senderJid: orgPhone.phoneJid,
        fromMe: true,
        content: messageContent,
        mediaUrl: mediaUrl,
        type,
        timestamp: new Date(),
        status: 'sent',
        senderUserId: res.locals.userId,
        isReadByOperator: true,
        isHr: chat?.isHr === true,
      },
    });

    res.json({ success: true, messageId: result.messages?.[0]?.id, data: result });
  } catch (error: any) {
    logger.error('❌ WABA: Send message error:', error);
    
    // Более детальная информация об ошибке
    const errorMessage = error.response?.data?.error?.message || error.message;
    const errorDetails = error.response?.data || {};
    
    res.status(500).json({ 
      error: errorMessage,
      details: errorDetails,
      type: error.response?.data?.error?.type
    });
  }
};

/**
 * Массовая отправка шаблонного сообщения через WABA
 * POST /api/waba/broadcast-template
 */
export const broadcastTemplate = async (req: Request, res: Response) => {
  try {
    const canAccessHrChats = userCanAccessHrChats(res.locals);
    const {
      organizationPhoneId,
      recipients,
      templateName,
      language = 'ru',
      components = [{ type: 'body', parameters: [] }],
      delayMs = 250,
      dryRun = false,
    } = req.body;

    if (!organizationPhoneId || !Array.isArray(recipients) || recipients.length === 0 || !templateName) {
      return res.status(400).json({
        error: 'organizationPhoneId, recipients[] and templateName are required',
      });
    }

    const parsedOrganizationPhoneId = Number(organizationPhoneId);
    if (!Number.isInteger(parsedOrganizationPhoneId) || parsedOrganizationPhoneId <= 0) {
      return res.status(400).json({ error: 'organizationPhoneId must be a positive integer' });
    }

    const orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        id: parsedOrganizationPhoneId,
        organizationId: res.locals.organizationId,
        connectionType: 'waba',
      },
    });

    if (!orgPhone) {
      return res.status(404).json({ error: 'Organization phone not found or not configured for WABA' });
    }

    const normalizedRecipients = recipients
      .map(normalizePhone)
      .filter((value): value is string => Boolean(value));

    if (normalizedRecipients.length === 0) {
      return res.status(400).json({ error: 'No valid recipients after phone normalization' });
    }

    const payload: BroadcastPayload = {
      organizationPhoneId: parsedOrganizationPhoneId,
      recipients,
      normalizedRecipients,
      templateName: String(templateName),
      language: String(language),
      components: Array.isArray(components) ? components : [],
      delayMs: parseDelayMs(delayMs),
      dryRun: parseBoolean(dryRun, false),
    };
    const userId = Number(res.locals.userId);
    const context: BroadcastContext = {
      organizationId: orgPhone.organizationId,
      userId: Number.isInteger(userId) ? userId : undefined,
      canAccessHrChats,
    };

    const wabaService = await createWABAService(parsedOrganizationPhoneId);
    if (!wabaService && !payload.dryRun) {
      return res.status(500).json({
        error: 'WABA service not configured',
        details: 'wabaAccessToken is missing in database. Please update OrganizationPhone with your permanent System User Access Token from Meta.',
      });
    }

    const asyncRequested = req.body.async ?? req.body.runAsync;
    const runAsync = asyncRequested === undefined
      ? normalizedRecipients.length > WABA_BROADCAST_SYNC_RECIPIENT_LIMIT
      : parseBoolean(asyncRequested, false);

    if (runAsync) {
      const job = startBroadcastTemplateJob({
        orgPhone,
        payload,
        context,
        wabaService,
      });

      return res.status(202).json({
        success: true,
        accepted: true,
        mode: 'async',
        jobId: job.id,
        status: job.status,
        statusUrl: `/api/waba/broadcast-template/jobs/${job.id}`,
        dryRun: job.dryRun,
        organizationPhoneId: job.organizationPhoneId,
        templateName: job.templateName,
        language: job.language,
        delayMs: job.delayMs,
        totals: job.totals,
      });
    }

    const result = await executeBroadcastTemplate({
      orgPhone,
      payload,
      context,
      wabaService,
    });

    res.json({
      mode: 'sync',
      ...result,
    });
  } catch (error: any) {
    logger.error('❌ WABA: Broadcast template error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Статус фоновой массовой отправки шаблонного сообщения через WABA
 * GET /api/waba/broadcast-template/jobs/:jobId
 */
export const getBroadcastTemplateJob = async (req: Request, res: Response) => {
  try {
    cleanupBroadcastJobs();

    const jobId = String(req.params.jobId || '');
    const job = broadcastJobs.get(jobId);

    if (!job || job.organizationId !== res.locals.organizationId) {
      return res.status(404).json({ error: 'Broadcast job not found' });
    }

    res.json({
      id: job.id,
      status: job.status,
      success: job.success,
      dryRun: job.dryRun,
      organizationPhoneId: job.organizationPhoneId,
      templateName: job.templateName,
      language: job.language,
      delayMs: job.delayMs,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
      error: job.error,
      totals: job.totals,
      results: job.results,
    });
  } catch (error: any) {
    logger.error('❌ WABA: Broadcast template job status error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Отправка сообщения оператором (упрощённый API)
 * POST /api/waba/operator/send
 */
export const operatorSendMessage = async (req: Request, res: Response) => {
  try {
    const { chatId, message, type = 'text', mediaUrl, caption, filename, template } = req.body;
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    if (!chatId || !message) {
      return res.status(400).json({ error: 'chatId and message are required' });
    }

    // Получаем чат с проверкой доступа
    const chat = await prisma.chat.findFirst({
      where: {
        id: chatId,
        organizationId: res.locals.organizationId,
        ...chatVisibilityWhere(canAccessHrChats),
      },
      include: {
        organizationPhone: true,
      },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    if (chat.organizationPhone.connectionType !== 'waba') {
      return res.status(400).json({ error: 'This chat is not using WABA' });
    }

    const wabaService = await createWABAService(chat.organizationPhoneId);
    if (!wabaService) {
      return res.status(500).json({ 
        error: 'WABA service not configured',
        details: 'wabaAccessToken is missing'
      });
    }

    // Отправляем сообщение в зависимости от типа
    let result;
    let messageContent = '';
    const recipientPhone = chat.remoteJid.replace('@s.whatsapp.net', '');

    switch (type) {
      case 'text':
        result = await wabaService.sendTextMessage(recipientPhone, message);
        messageContent = message;
        break;
      case 'image':
        if (!mediaUrl) {
          return res.status(400).json({ error: 'mediaUrl is required for image type' });
        }
        result = await wabaService.sendImage(recipientPhone, mediaUrl, caption);
        messageContent = caption || '[Image]';
        break;
      case 'document':
        if (!mediaUrl) {
          return res.status(400).json({ error: 'mediaUrl is required for document type' });
        }
        result = await wabaService.sendDocument(recipientPhone, mediaUrl, filename, caption);
        messageContent = caption || `[Document: ${filename || 'file'}]`;
        break;
      case 'template':
        if (!template || !template.name) {
          return res.status(400).json({ error: 'template object with name is required for template type' });
        }
        result = await wabaService.sendTemplateMessage(
          recipientPhone,
          template.name,
          template.language || 'ru',
          template.components
        );
        messageContent = `Template: ${template.name}`;
        break;
      default:
        return res.status(400).json({ error: 'Unsupported message type. Use: text, image, document, template' });
    }

    // Сохраняем в БД
    const savedMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        organizationPhoneId: chat.organizationPhoneId,
        organizationId: chat.organizationId,
        channel: 'whatsapp',
        whatsappMessageId: result.messages?.[0]?.id,
        receivingPhoneJid: chat.organizationPhone.phoneJid,
        remoteJid: chat.remoteJid,
        senderJid: chat.organizationPhone.phoneJid,
        fromMe: true,
        content: messageContent,
        mediaUrl: mediaUrl || null,
        type: type,
        timestamp: new Date(),
        status: 'sent',
        senderUserId: res.locals.userId,
        isReadByOperator: true,
        isHr: chat.isHr,
      },
    });

    // Обновляем lastMessageAt в чате
    await prisma.chat.update({
      where: { id: chat.id },
      data: { lastMessageAt: new Date() },
    });

    logger.info(`📤 WABA Operator: Message sent by user ${res.locals.userId} to chat ${chatId}`);

    res.json({ 
      success: true, 
      messageId: result.messages?.[0]?.id,
      message: savedMessage
    });
  } catch (error: any) {
    logger.error('❌ WABA Operator: Send message error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Получение статуса доставки сообщения
 * GET /api/waba/operator/message-status/:messageId
 */
export const getMessageStatus = async (req: Request, res: Response) => {
  try {
    const { messageId } = req.params;
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    const message = await prisma.message.findFirst({
      where: {
        id: parseInt(messageId),
        organizationId: res.locals.organizationId,
        ...messageVisibilityWhere(canAccessHrChats),
        chat: chatVisibilityWhere(canAccessHrChats),
      },
      select: {
        id: true,
        whatsappMessageId: true,
        status: true,
        timestamp: true,
        content: true,
        fromMe: true,
        chat: {
          select: {
            id: true,
            remoteJid: true,
          },
        },
      },
    });

    if (!message) {
      return res.status(404).json({ error: 'Message not found' });
    }

    res.json({
      id: message.id,
      whatsappMessageId: message.whatsappMessageId,
      status: message.status,
      timestamp: message.timestamp,
      delivered: ['delivered', 'read'].includes(message.status || ''),
      read: message.status === 'read',
    });
  } catch (error: any) {
    logger.error('❌ WABA: Get message status error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Получение истории сообщений чата с WABA статусами
 * GET /api/waba/operator/chat/:chatId/messages
 */
export const getChatMessages = async (req: Request, res: Response) => {
  try {
    const { chatId } = req.params;
    const { limit = '50', offset = '0' } = req.query;
    const canAccessHrChats = userCanAccessHrChats(res.locals);

    const chat = await prisma.chat.findFirst({
      where: {
        id: parseInt(chatId),
        organizationId: res.locals.organizationId,
        ...chatVisibilityWhere(canAccessHrChats),
      },
      select: {
        id: true,
        assignedUserId: true,
        assignedUser: {
          select: {
            id: true,
            name: true,
            email: true,
          },
        },
      },
    });

    if (!chat) {
      return res.status(404).json({ error: 'Chat not found' });
    }

    const messages = await prisma.message.findMany({
      where: { chatId: chat.id, ...messageVisibilityWhere(canAccessHrChats) },
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit as string),
      skip: parseInt(offset as string),
      select: {
        id: true,
        whatsappMessageId: true,
        content: true,
        mediaUrl: true,
        type: true,
        fromMe: true,
        timestamp: true,
        status: true,
        isReadByOperator: true,
        quotedMessageId: true,
        quotedContent: true, // Добавлено для отображения реплаев
        senderUser: {
          select: {
            id: true,
            email: true,
          },
        },
      },
    });

    const total = await prisma.message.count({
      where: { chatId: chat.id, ...messageVisibilityWhere(canAccessHrChats) },
    });

    const hasResponsible = Boolean(chat.assignedUserId);
    const responsibleUser = hasResponsible ? chat.assignedUser : null;

    res.json({
      messages: messages.map(msg => ({
        ...msg,
        delivered: ['delivered', 'read'].includes(msg.status || ''),
        read: msg.status === 'read',
        hasResponsible,
        responsibleUser,
      })),
      total,
      limit: parseInt(limit as string),
      offset: parseInt(offset as string),
    });
  } catch (error: any) {
    logger.error('❌ WABA: Get chat messages error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Диагностика WABA конфигурации без отправки сообщения
 * GET /api/waba/diagnostics?organizationPhoneId=1
 */
export const getDiagnostics = async (req: Request, res: Response) => {
  try {
    const { organizationPhoneId, apiVersion: requestedApiVersion } = req.query;

    if (!organizationPhoneId) {
      return res.status(400).json({ error: 'organizationPhoneId is required' });
    }

    const orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        id: Number(organizationPhoneId),
        organizationId: res.locals.organizationId,
        connectionType: 'waba',
      },
      select: {
        id: true,
        phoneJid: true,
        connectionType: true,
        wabaAccessToken: true,
        wabaPhoneNumberId: true,
        wabaId: true,
        wabaApiVersion: true,
      },
    });

    if (!orgPhone) {
      return res.status(404).json({ error: 'Organization phone not found or not configured for WABA' });
    }

    const apiVersion = requestedApiVersion ? String(requestedApiVersion) : orgPhone.wabaApiVersion || 'v21.0';
    if (!/^v\d+\.\d+$/.test(apiVersion)) {
      return res.status(400).json({ error: 'apiVersion must look like v21.0' });
    }

    const baseUrl = `https://graph.facebook.com/${apiVersion}`;
    const diagnostics: Record<string, any> = {
      organizationPhoneId: orgPhone.id,
      config: {
        phoneJid: orgPhone.phoneJid,
        connectionType: orgPhone.connectionType,
        wabaPhoneNumberId: orgPhone.wabaPhoneNumberId,
        wabaId: orgPhone.wabaId,
        storedWabaApiVersion: orgPhone.wabaApiVersion || 'v21.0',
        testedWabaApiVersion: apiVersion,
        isVersionOverride: Boolean(requestedApiVersion),
        hasWabaAccessToken: Boolean(orgPhone.wabaAccessToken),
        wabaAccessTokenLength: orgPhone.wabaAccessToken?.length || 0,
      },
      checks: {},
    };

    if (!orgPhone.wabaAccessToken || !orgPhone.wabaPhoneNumberId) {
      diagnostics.checks.config = {
        ok: false,
        error: 'wabaAccessToken and wabaPhoneNumberId are required',
      };
      return res.status(500).json(diagnostics);
    }

    const authHeaders = {
      Authorization: `Bearer ${orgPhone.wabaAccessToken}`,
    };

    const phoneFields = 'id,display_phone_number,verified_name,quality_rating,platform_type';
    try {
      const phoneResponse = await axios.get(`${baseUrl}/${orgPhone.wabaPhoneNumberId}`, {
        headers: authHeaders,
        params: { fields: phoneFields },
      });
      diagnostics.checks.phoneNumber = {
        ok: true,
        graphPath: `/${apiVersion}/${orgPhone.wabaPhoneNumberId}`,
        fields: phoneFields,
        responseStatus: phoneResponse.status,
        data: phoneResponse.data,
      };
    } catch (error: any) {
      diagnostics.checks.phoneNumber = {
        ok: false,
        graphPath: `/${apiVersion}/${orgPhone.wabaPhoneNumberId}`,
        fields: phoneFields,
        error: getGraphErrorSnapshot(error),
      };
    }

    if (orgPhone.wabaId) {
      try {
        const templatesResponse = await axios.get(`${baseUrl}/${orgPhone.wabaId}/message_templates`, {
          headers: authHeaders,
          params: {
            limit: 1,
            fields: 'id,name,language,status,category',
          },
        });
        diagnostics.checks.templates = {
          ok: true,
          graphPath: `/${apiVersion}/${orgPhone.wabaId}/message_templates`,
          responseStatus: templatesResponse.status,
          count: Array.isArray(templatesResponse.data?.data) ? templatesResponse.data.data.length : 0,
          sample: templatesResponse.data?.data?.[0] || null,
          paging: templatesResponse.data?.paging || null,
        };
      } catch (error: any) {
        diagnostics.checks.templates = {
          ok: false,
          graphPath: `/${apiVersion}/${orgPhone.wabaId}/message_templates`,
          error: getGraphErrorSnapshot(error),
        };
      }
    } else {
      diagnostics.checks.templates = {
        ok: false,
        skipped: true,
        reason: 'wabaId is missing',
      };
    }

    const hasFailedChecks = Object.values(diagnostics.checks).some((check: any) => check?.ok === false && !check?.skipped);
    res.status(hasFailedChecks ? 502 : 200).json(diagnostics);
  } catch (error: any) {
    logger.error('❌ WABA: Diagnostics error:', error);
    res.status(500).json({ error: error.message });
  }
};

/**
 * Получение шаблонов сообщений
 * GET /api/waba/templates
 */
export const getTemplates = async (req: Request, res: Response) => {
  try {
    const { organizationPhoneId, limit, after, name, language, status, category } = req.query;

    if (!organizationPhoneId) {
      return res.status(400).json({ error: 'organizationPhoneId is required' });
    }

    const orgPhone = await prisma.organizationPhone.findFirst({
      where: {
        id: Number(organizationPhoneId),
        organizationId: res.locals.organizationId,
        connectionType: 'waba',
      },
      select: {
        id: true,
        wabaId: true,
        wabaPhoneNumberId: true,
      },
    });

    if (!orgPhone) {
      return res.status(404).json({ error: 'Organization phone not found or not configured for WABA' });
    }

    const wabaService = await createWABAService(Number(organizationPhoneId));
    if (!wabaService) {
      return res.status(500).json({ error: 'WABA service not configured' });
    }

    const templates = await wabaService.getTemplates({
      limit: limit ? Number(limit) : undefined,
      after: after ? String(after) : undefined,
      name: name ? String(name) : undefined,
      language: language ? String(language) : undefined,
      status: status ? String(status) : undefined,
      category: category ? String(category) : undefined,
    });

    res.json({
      organizationPhoneId: Number(organizationPhoneId),
      data: templates?.data || [],
      paging: templates?.paging || null,
      raw: templates,
    });
  } catch (error: any) {
    logger.error('❌ WABA: Get templates error:', error);
    const errorMessage = error.response?.data?.error?.message || error.message;
    const errorDetails = error.response?.data || {};
    res.status(500).json({
      error: errorMessage,
      details: errorDetails,
      type: error.response?.data?.error?.type,
    });
  }
};

/**
 * Просмотр логов WABA webhook
 * GET /api/waba/logs
 */
export const getWabaLogs = async (req: Request, res: Response) => {
  try {
    const { limit = '50', offset = '0' } = req.query;
    const orgId = res.locals.organizationId;

    const logs = await (prisma as any).wabaWebhookLog.findMany({
      where: {
        organizationPhone: {
          organizationId: orgId,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: Number(limit),
      skip: Number(offset),
      include: { organizationPhone: true },
    });

    res.json({ logs });
  } catch (error: any) {
    logger.error('❌ WABA: Get logs error:', error);
    res.status(500).json({ error: error.message });
  }
};
