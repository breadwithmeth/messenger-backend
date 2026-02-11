// src/controllers/analyticsController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import { Prisma } from '@prisma/client';
import pino from 'pino';

const logger = pino({ level: 'info' });

function parseDateParam(raw: unknown): Date | null {
  if (!raw || typeof raw !== 'string') return null;
  const d = new Date(raw);
  return Number.isFinite(d.getTime()) ? d : null;
}

function parseIntParam(raw: unknown): number | null {
  if (raw === undefined || raw === null) return null;
  const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isFinite(n) ? n : null;
}

/**
 * Аналитика по чатам (summary) для организации.
 * GET /api/analytics/chats?from=2026-02-01&to=2026-02-11&channel=whatsapp|telegram&organizationPhoneId=123&assignedUserId=45
 */
export const getChatAnalytics = async (req: Request, res: Response) => {
  const organizationId = res.locals.organizationId as number | undefined;
  if (!organizationId) {
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  const now = new Date();
  const from = parseDateParam(req.query.from) ?? new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const to = parseDateParam(req.query.to) ?? now;

  if (from > to) {
    return res.status(400).json({ error: 'Некорректный диапазон дат: from > to' });
  }

  const channel = typeof req.query.channel === 'string' ? req.query.channel : null;
  const organizationPhoneId = parseIntParam(req.query.organizationPhoneId);
  const assignedUserId = parseIntParam(req.query.assignedUserId);

  try {
    // Базовые where для Chat
    const chatWhere: any = {
      organizationId,
    };
    if (channel) chatWhere.channel = channel;
    if (organizationPhoneId) chatWhere.organizationPhoneId = organizationPhoneId;
    if (assignedUserId !== null) chatWhere.assignedUserId = assignedUserId;

    // 1) Чаты: создано за период, активных за период (есть сообщения), распределение по статусам
    const chatsCreatedPromise = prisma.chat.count({
      where: {
        ...chatWhere,
        createdAt: { gte: from, lte: to },
      },
    });

    const activeChatsPromise = prisma.message.findMany({
      where: {
        organizationId,
        timestamp: { gte: from, lte: to },
        chat: chatWhere,
      },
      distinct: ['chatId'],
      select: { chatId: true },
    });

    const byStatusPromise = prisma.chat.groupBy({
      by: ['status'],
      where: chatWhere,
      _count: true,
    });

    const byChannelPromise = prisma.chat.groupBy({
      by: ['channel'],
      where: {
        organizationId,
        ...(channel ? { channel } : {}),
      },
      _count: true,
    });

    // 2) Сообщения за период
    const totalMessagesPromise = prisma.message.count({
      where: {
        organizationId,
        timestamp: { gte: from, lte: to },
        chat: chatWhere,
      },
    });

    const inboundMessagesPromise = prisma.message.count({
      where: {
        organizationId,
        timestamp: { gte: from, lte: to },
        fromMe: false,
        chat: chatWhere,
      },
    });

    const outboundMessagesPromise = prisma.message.count({
      where: {
        organizationId,
        timestamp: { gte: from, lte: to },
        fromMe: true,
        chat: chatWhere,
      },
    });

    // 3) SLA: время первого ответа оператора на первое входящее сообщение (в рамках периода)
    // Считаем ответом сообщение, у которого senderUserId != null.
    // (Если у вас часть исходящих не проставляет senderUserId, это место стоит расширить.)

    const extraChatFilters: Prisma.Sql[] = [];
    if (channel) extraChatFilters.push(Prisma.sql`AND c."channel" = ${channel}`);
    if (organizationPhoneId) extraChatFilters.push(Prisma.sql`AND c."organizationPhoneId" = ${organizationPhoneId}`);
    if (assignedUserId !== null) extraChatFilters.push(Prisma.sql`AND c."assignedUserId" = ${assignedUserId}`);

    const responseTimeSql = Prisma.sql`
      WITH first_inbound AS (
        SELECT m."chatId" AS chat_id, MIN(m."timestamp") AS first_inbound
        FROM "Message" m
        JOIN "Chat" c ON c."id" = m."chatId"
        WHERE m."organizationId" = ${organizationId}
          AND m."fromMe" = false
          AND m."timestamp" >= ${from}
          AND m."timestamp" <= ${to}
          AND c."organizationId" = ${organizationId}
          ${Prisma.join(extraChatFilters, ' ')}
        GROUP BY m."chatId"
      ),
      first_response AS (
        SELECT fi.chat_id,
               fi.first_inbound,
               (
                 SELECT MIN(m2."timestamp")
                 FROM "Message" m2
                 WHERE m2."organizationId" = ${organizationId}
                   AND m2."chatId" = fi.chat_id
                   AND m2."senderUserId" IS NOT NULL
                   AND m2."timestamp" >= fi.first_inbound
                   AND m2."timestamp" <= ${to}
               ) AS first_reply
        FROM first_inbound fi
      )
      SELECT
        COUNT(*) FILTER (WHERE first_reply IS NOT NULL) AS chats_with_response,
        AVG(EXTRACT(EPOCH FROM (first_reply - first_inbound))) FILTER (WHERE first_reply IS NOT NULL) AS avg_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_reply - first_inbound)))
          FILTER (WHERE first_reply IS NOT NULL) AS p50_seconds
      FROM first_response;
    `;

    const resolutionTimeSql = Prisma.sql`
      WITH first_inbound_any AS (
        SELECT m."chatId" AS chat_id, MIN(m."timestamp") AS first_inbound
        FROM "Message" m
        JOIN "Chat" c ON c."id" = m."chatId"
        WHERE m."organizationId" = ${organizationId}
          AND m."fromMe" = false
          AND c."organizationId" = ${organizationId}
          ${Prisma.join(extraChatFilters, ' ')}
        GROUP BY m."chatId"
      )
      SELECT
        COUNT(*) FILTER (WHERE COALESCE(c."resolvedAt", c."closedAt") IS NOT NULL) AS chats_closed,
        AVG(EXTRACT(EPOCH FROM (COALESCE(c."resolvedAt", c."closedAt") - fi.first_inbound)))
          FILTER (WHERE COALESCE(c."resolvedAt", c."closedAt") IS NOT NULL) AS avg_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (COALESCE(c."resolvedAt", c."closedAt") - fi.first_inbound)))
          FILTER (WHERE COALESCE(c."resolvedAt", c."closedAt") IS NOT NULL) AS p50_seconds
      FROM first_inbound_any fi
      JOIN "Chat" c ON c."id" = fi.chat_id
      WHERE COALESCE(c."resolvedAt", c."closedAt") >= ${from}
        AND COALESCE(c."resolvedAt", c."closedAt") <= ${to};
    `;

    const responseTimePromise = prisma.$queryRaw<any[]>(responseTimeSql);
    const resolutionTimePromise = prisma.$queryRaw<any[]>(resolutionTimeSql);

    const [
      chatsCreated,
      activeChatsRows,
      byStatus,
      byChannel,
      totalMessages,
      inboundMessages,
      outboundMessages,
      responseTimeRows,
      resolutionTimeRows,
    ] = await Promise.all([
      chatsCreatedPromise,
      activeChatsPromise,
      byStatusPromise,
      byChannelPromise,
      totalMessagesPromise,
      inboundMessagesPromise,
      outboundMessagesPromise,
      responseTimePromise,
      resolutionTimePromise,
    ]);

    const statusStats: Record<string, number> = {};
    for (const item of byStatus) {
      statusStats[item.status] = (item as any)._count;
    }

    const channelStats: Record<string, number> = {};
    for (const item of byChannel) {
      channelStats[item.channel] = (item as any)._count;
    }

    const responseTime = responseTimeRows?.[0] ?? {};
    const resolutionTime = resolutionTimeRows?.[0] ?? {};

    const activeChats = Array.isArray(activeChatsRows) ? activeChatsRows.length : 0;

    res.json({
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      filters: {
        channel: channel ?? null,
        organizationPhoneId: organizationPhoneId ?? null,
        assignedUserId: assignedUserId ?? null,
      },
      chats: {
        created: chatsCreated,
        active: activeChats,
        byStatus: statusStats,
        byChannel: channelStats,
      },
      messages: {
        total: totalMessages,
        inbound: inboundMessages,
        outbound: outboundMessages,
      },
      sla: {
        firstResponseSeconds: {
          chatsWithResponse: Number(responseTime.chats_with_response ?? 0),
          avg: responseTime.avg_seconds === null || responseTime.avg_seconds === undefined ? null : Number(responseTime.avg_seconds),
          p50: responseTime.p50_seconds === null || responseTime.p50_seconds === undefined ? null : Number(responseTime.p50_seconds),
        },
        resolutionSeconds: {
          chatsClosed: Number(resolutionTime.chats_closed ?? 0),
          avg: resolutionTime.avg_seconds === null || resolutionTime.avg_seconds === undefined ? null : Number(resolutionTime.avg_seconds),
          p50: resolutionTime.p50_seconds === null || resolutionTime.p50_seconds === undefined ? null : Number(resolutionTime.p50_seconds),
        },
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, '[getChatAnalytics] Ошибка получения аналитики по чатам');
    res.status(500).json({ error: 'Ошибка получения аналитики по чатам', details: error.message });
  }
};
