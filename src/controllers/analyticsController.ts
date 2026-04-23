// src/controllers/analyticsController.ts

import { Request, Response } from 'express';
import { prisma } from '../config/authStorage';
import { Prisma } from '@prisma/client';
import pino from 'pino';

const logger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

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

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isFinite(n)) return min;
  return Math.min(max, Math.max(min, Math.trunc(n)));
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
  const idleMinutesRaw = parseIntParam(req.query.idleMinutes);
  const idleMinutes = clampInt(idleMinutesRaw ?? 120, 5, 24 * 60);
  const idleSeconds = idleMinutes * 60;
  const windowStart = new Date(from.getTime() - idleSeconds * 1000);

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

    const extraChatFiltersSql = extraChatFilters.length ? Prisma.join(extraChatFilters, ' ') : Prisma.empty;

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
          ${extraChatFiltersSql}
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
          ${extraChatFiltersSql}
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

    // 4) Тикетизация: один chat => несколько "тикетов", если пауза между любыми сообщениями > idleMinutes.
    // Считаем тикет-сессию по Message timeline в рамках chatId.
    const ticketsSql = Prisma.sql`
      WITH msgs AS (
        SELECT m."chatId" AS chat_id,
               m."timestamp" AS ts,
               m."fromMe" AS from_me,
               m."senderUserId" AS sender_user_id
        FROM "Message" m
        JOIN "Chat" c ON c."id" = m."chatId"
        WHERE m."organizationId" = ${organizationId}
          AND m."timestamp" >= ${windowStart}
          AND m."timestamp" <= ${to}
          AND c."organizationId" = ${organizationId}
          ${extraChatFiltersSql}
      ),
      ordered AS (
        SELECT *,
               LAG(ts) OVER (PARTITION BY chat_id ORDER BY ts) AS prev_ts
        FROM msgs
      ),
      marked AS (
        SELECT *,
               CASE
                 WHEN prev_ts IS NULL THEN 1
                 WHEN EXTRACT(EPOCH FROM (ts - prev_ts)) > ${idleSeconds} THEN 1
                 ELSE 0
               END AS is_new
        FROM ordered
      ),
      sess AS (
        SELECT *,
               SUM(is_new) OVER (PARTITION BY chat_id ORDER BY ts) AS session_no
        FROM marked
      ),
      bounds AS (
        SELECT chat_id,
               session_no,
               MIN(ts) AS started_at,
               MAX(ts) AS last_at,
               MIN(ts) FILTER (WHERE from_me = false) AS first_inbound_at
        FROM sess
        GROUP BY chat_id, session_no
      ),
      activity AS (
        SELECT chat_id,
               session_no,
               BOOL_OR(ts >= ${from} AND ts <= ${to}) AS has_in_period
        FROM sess
        GROUP BY chat_id, session_no
      ),
      replies AS (
        SELECT b.chat_id,
               b.session_no,
               (
                 SELECT MIN(s2.ts)
                 FROM sess s2
                 WHERE s2.chat_id = b.chat_id
                   AND s2.session_no = b.session_no
                   AND s2.sender_user_id IS NOT NULL
                   AND b.first_inbound_at IS NOT NULL
                   AND s2.ts >= b.first_inbound_at
                   AND s2.ts <= ${to}
               ) AS first_reply_at
        FROM bounds b
      ),
      joined AS (
        SELECT b.chat_id,
               b.session_no,
               b.started_at,
               b.last_at,
               b.first_inbound_at,
               a.has_in_period,
               r.first_reply_at
        FROM bounds b
        JOIN activity a ON a.chat_id = b.chat_id AND a.session_no = b.session_no
        JOIN replies r ON r.chat_id = b.chat_id AND r.session_no = b.session_no
      )
      SELECT
        COUNT(*) FILTER (WHERE started_at >= ${from} AND started_at <= ${to}) AS tickets_started,
        COUNT(*) FILTER (WHERE has_in_period) AS tickets_active,
        COUNT(*) FILTER (WHERE has_in_period AND EXTRACT(EPOCH FROM (${to} - last_at)) <= ${idleSeconds}) AS tickets_open_at_end,
        COUNT(*) FILTER (WHERE has_in_period AND EXTRACT(EPOCH FROM (${to} - last_at)) > ${idleSeconds}) AS tickets_closed_by_idle_at_end,
        COUNT(*) FILTER (WHERE started_at >= ${from} AND started_at <= ${to} AND first_inbound_at IS NOT NULL) AS tickets_with_inbound,
        COUNT(*) FILTER (
          WHERE started_at >= ${from} AND started_at <= ${to}
            AND first_inbound_at IS NOT NULL
            AND first_reply_at IS NOT NULL
        ) AS tickets_with_response,
        AVG(EXTRACT(EPOCH FROM (first_reply_at - first_inbound_at))) FILTER (
          WHERE started_at >= ${from} AND started_at <= ${to}
            AND first_inbound_at IS NOT NULL
            AND first_reply_at IS NOT NULL
        ) AS avg_first_response_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_reply_at - first_inbound_at))) FILTER (
          WHERE started_at >= ${from} AND started_at <= ${to}
            AND first_inbound_at IS NOT NULL
            AND first_reply_at IS NOT NULL
        ) AS p50_first_response_seconds
      FROM joined;
    `;

    const ticketsPromise = prisma.$queryRaw<any[]>(ticketsSql);

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
      ticketsRows,
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
      ticketsPromise,
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
    const tickets = ticketsRows?.[0] ?? {};

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
      tickets: {
        idleMinutes,
        started: Number(tickets.tickets_started ?? 0),
        active: Number(tickets.tickets_active ?? 0),
        openAtEnd: Number(tickets.tickets_open_at_end ?? 0),
        closedByIdleAtEnd: Number(tickets.tickets_closed_by_idle_at_end ?? 0),
        withInbound: Number(tickets.tickets_with_inbound ?? 0),
        withResponse: Number(tickets.tickets_with_response ?? 0),
        firstResponseSeconds: {
          avg:
            tickets.avg_first_response_seconds === null || tickets.avg_first_response_seconds === undefined
              ? null
              : Number(tickets.avg_first_response_seconds),
          p50:
            tickets.p50_first_response_seconds === null || tickets.p50_first_response_seconds === undefined
              ? null
              : Number(tickets.p50_first_response_seconds),
        },
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

/**
 * Аналитика по операторам (summary) для организации.
 * GET /api/analytics/operators?from=2026-02-01&to=2026-02-11&channel=whatsapp|telegram&organizationPhoneId=123&operatorId=45&idleMinutes=120
 */
export const getOperatorAnalytics = async (req: Request, res: Response) => {
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
  const operatorId = parseIntParam(req.query.operatorId);

  const idleMinutesRaw = parseIntParam(req.query.idleMinutes);
  const idleMinutes = clampInt(idleMinutesRaw ?? 120, 5, 24 * 60);
  const idleSeconds = idleMinutes * 60;
  const windowStart = new Date(from.getTime() - idleSeconds * 1000);

  try {
    const usersPromise = prisma.user.findMany({
      where: {
        organizationId,
        ...(operatorId !== null ? { id: operatorId } : {}),
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
      orderBy: { id: 'asc' },
    });

    const chatWhere: any = {
      organizationId,
    };
    if (channel) chatWhere.channel = channel;
    if (organizationPhoneId) chatWhere.organizationPhoneId = organizationPhoneId;

    // Исходящие сообщения по операторам (берём только те, где senderUserId проставлен)
    const outboundByOperatorPromise = prisma.message.groupBy({
      by: ['senderUserId'],
      where: {
        organizationId,
        timestamp: { gte: from, lte: to },
        senderUserId: { not: null },
        fromMe: true,
        chat: chatWhere,
      },
      _count: { _all: true },
    });

    // touchedChats: сколько уникальных чатов, где оператор отправлял сообщение в период
    const touchedChatsSql = Prisma.sql`
      SELECT
        m."senderUserId" AS user_id,
        COUNT(DISTINCT m."chatId")::int AS touched_chats
      FROM "Message" m
      JOIN "Chat" c ON c."id" = m."chatId"
      WHERE m."organizationId" = ${organizationId}
        AND m."timestamp" >= ${from}
        AND m."timestamp" <= ${to}
        AND m."senderUserId" IS NOT NULL
        AND c."organizationId" = ${organizationId}
        ${channel ? Prisma.sql`AND c."channel" = ${channel}` : Prisma.empty}
        ${organizationPhoneId ? Prisma.sql`AND c."organizationPhoneId" = ${organizationPhoneId}` : Prisma.empty}
        ${operatorId !== null ? Prisma.sql`AND m."senderUserId" = ${operatorId}` : Prisma.empty}
      GROUP BY m."senderUserId";
    `;

    const touchedChatsPromise = prisma.$queryRaw<any[]>(touchedChatsSql);

    // assignedActiveChats: сколько уникальных активных чатов в периоде, назначенных на оператора
    const assignedActiveChatsSql = Prisma.sql`
      SELECT
        c."assignedUserId" AS user_id,
        COUNT(DISTINCT m."chatId")::int AS active_assigned_chats
      FROM "Message" m
      JOIN "Chat" c ON c."id" = m."chatId"
      WHERE m."organizationId" = ${organizationId}
        AND m."timestamp" >= ${from}
        AND m."timestamp" <= ${to}
        AND c."organizationId" = ${organizationId}
        AND c."assignedUserId" IS NOT NULL
        ${channel ? Prisma.sql`AND c."channel" = ${channel}` : Prisma.empty}
        ${organizationPhoneId ? Prisma.sql`AND c."organizationPhoneId" = ${organizationPhoneId}` : Prisma.empty}
        ${operatorId !== null ? Prisma.sql`AND c."assignedUserId" = ${operatorId}` : Prisma.empty}
      GROUP BY c."assignedUserId";
    `;

    const assignedActiveChatsPromise = prisma.$queryRaw<any[]>(assignedActiveChatsSql);

    // SLA по «тикетам» (сессиям): считаем первую реакцию и атрибутируем её оператору, который ответил первым
    const ticketsByOperatorSql = Prisma.sql`
      WITH msgs AS (
        SELECT m."chatId" AS chat_id,
               m."timestamp" AS ts,
               m."fromMe" AS from_me,
               m."senderUserId" AS sender_user_id
        FROM "Message" m
        JOIN "Chat" c ON c."id" = m."chatId"
        WHERE m."organizationId" = ${organizationId}
          AND m."timestamp" >= ${windowStart}
          AND m."timestamp" <= ${to}
          AND c."organizationId" = ${organizationId}
          ${channel ? Prisma.sql`AND c."channel" = ${channel}` : Prisma.empty}
          ${organizationPhoneId ? Prisma.sql`AND c."organizationPhoneId" = ${organizationPhoneId}` : Prisma.empty}
      ),
      ordered AS (
        SELECT *,
               LAG(ts) OVER (PARTITION BY chat_id ORDER BY ts) AS prev_ts
        FROM msgs
      ),
      marked AS (
        SELECT *,
               CASE
                 WHEN prev_ts IS NULL THEN 1
                 WHEN EXTRACT(EPOCH FROM (ts - prev_ts)) > ${idleSeconds} THEN 1
                 ELSE 0
               END AS is_new
        FROM ordered
      ),
      sess AS (
        SELECT *,
               SUM(is_new) OVER (PARTITION BY chat_id ORDER BY ts) AS session_no
        FROM marked
      ),
      bounds AS (
        SELECT chat_id,
               session_no,
               MIN(ts) AS started_at,
               MAX(ts) AS last_at,
               MIN(ts) FILTER (WHERE from_me = false) AS first_inbound_at
        FROM sess
        GROUP BY chat_id, session_no
      ),
      replies AS (
        SELECT b.chat_id,
               b.session_no,
               r.first_reply_at,
               r.first_reply_user_id
        FROM bounds b
        LEFT JOIN LATERAL (
          SELECT s2.ts AS first_reply_at,
                 s2.sender_user_id AS first_reply_user_id
          FROM sess s2
          WHERE s2.chat_id = b.chat_id
            AND s2.session_no = b.session_no
            AND s2.sender_user_id IS NOT NULL
            AND b.first_inbound_at IS NOT NULL
            AND s2.ts >= b.first_inbound_at
            AND s2.ts <= ${to}
          ORDER BY s2.ts ASC
          LIMIT 1
        ) r ON TRUE
      ),
      joined AS (
        SELECT b.chat_id,
               b.session_no,
               b.started_at,
               b.last_at,
               b.first_inbound_at,
               rp.first_reply_at,
               rp.first_reply_user_id
        FROM bounds b
        JOIN replies rp ON rp.chat_id = b.chat_id AND rp.session_no = b.session_no
      )
      SELECT
        first_reply_user_id AS user_id,
        COUNT(*) FILTER (
          WHERE started_at >= ${from} AND started_at <= ${to}
            AND first_inbound_at IS NOT NULL
            AND first_reply_at IS NOT NULL
            AND first_reply_user_id IS NOT NULL
        )::int AS tickets_answered,
        AVG(EXTRACT(EPOCH FROM (first_reply_at - first_inbound_at))) FILTER (
          WHERE started_at >= ${from} AND started_at <= ${to}
            AND first_inbound_at IS NOT NULL
            AND first_reply_at IS NOT NULL
            AND first_reply_user_id IS NOT NULL
        ) AS avg_first_response_seconds,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (first_reply_at - first_inbound_at))) FILTER (
          WHERE started_at >= ${from} AND started_at <= ${to}
            AND first_inbound_at IS NOT NULL
            AND first_reply_at IS NOT NULL
            AND first_reply_user_id IS NOT NULL
        ) AS p50_first_response_seconds
      FROM joined
      ${operatorId !== null ? Prisma.sql`WHERE first_reply_user_id = ${operatorId}` : Prisma.empty}
      GROUP BY first_reply_user_id;
    `;

    const ticketsByOperatorPromise = prisma.$queryRaw<any[]>(ticketsByOperatorSql);

    const [users, outboundByOperatorRows, touchedChatsRows, assignedActiveChatsRows, ticketsByOperatorRows] =
      await Promise.all([
        usersPromise,
        outboundByOperatorPromise,
        touchedChatsPromise,
        assignedActiveChatsPromise,
        ticketsByOperatorPromise,
      ]);

    const outboundByUserId = new Map<number, number>();
    for (const row of outboundByOperatorRows) {
      const userId = row.senderUserId as number | null;
      if (userId === null) continue;
      outboundByUserId.set(userId, Number((row as any)._count?._all ?? 0));
    }

    const touchedChatsByUserId = new Map<number, number>();
    for (const row of touchedChatsRows ?? []) {
      if (row.user_id === null || row.user_id === undefined) continue;
      touchedChatsByUserId.set(Number(row.user_id), Number(row.touched_chats ?? 0));
    }

    const assignedActiveChatsByUserId = new Map<number, number>();
    for (const row of assignedActiveChatsRows ?? []) {
      if (row.user_id === null || row.user_id === undefined) continue;
      assignedActiveChatsByUserId.set(Number(row.user_id), Number(row.active_assigned_chats ?? 0));
    }

    const ticketsByUserId = new Map<
      number,
      { ticketsAnswered: number; avgFirstResponseSeconds: number | null; p50FirstResponseSeconds: number | null }
    >();
    for (const row of ticketsByOperatorRows ?? []) {
      if (row.user_id === null || row.user_id === undefined) continue;
      ticketsByUserId.set(Number(row.user_id), {
        ticketsAnswered: Number(row.tickets_answered ?? 0),
        avgFirstResponseSeconds:
          row.avg_first_response_seconds === null || row.avg_first_response_seconds === undefined
            ? null
            : Number(row.avg_first_response_seconds),
        p50FirstResponseSeconds:
          row.p50_first_response_seconds === null || row.p50_first_response_seconds === undefined
            ? null
            : Number(row.p50_first_response_seconds),
      });
    }

    const operators = (users ?? []).map((u) => {
      const ticketStats = ticketsByUserId.get(u.id) ?? {
        ticketsAnswered: 0,
        avgFirstResponseSeconds: null,
        p50FirstResponseSeconds: null,
      };

      return {
        id: u.id,
        email: u.email,
        name: u.name ?? null,
        role: u.role,
        messages: {
          outbound: outboundByUserId.get(u.id) ?? 0,
        },
        chats: {
          touched: touchedChatsByUserId.get(u.id) ?? 0,
          assignedActive: assignedActiveChatsByUserId.get(u.id) ?? 0,
        },
        tickets: {
          idleMinutes,
          answered: ticketStats.ticketsAnswered,
          firstResponseSeconds: {
            avg: ticketStats.avgFirstResponseSeconds,
            p50: ticketStats.p50FirstResponseSeconds,
          },
        },
      };
    });

    res.json({
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      filters: {
        channel: channel ?? null,
        organizationPhoneId: organizationPhoneId ?? null,
        operatorId: operatorId ?? null,
      },
      operators,
    });
  } catch (error: any) {
    logger.error({ err: error }, '[getOperatorAnalytics] Ошибка получения аналитики по операторам');
    res.status(500).json({ error: 'Ошибка получения аналитики по операторам', details: error.message });
  }
};

/**
 * Список «тикетов» (сессий) по активности сообщений.
 * GET /api/analytics/tickets?from=...&to=...&channel=...&organizationPhoneId=...&assignedUserId=...&idleMinutes=120&limit=50&offset=0&state=open|closed
 */
export const listAnalyticsTickets = async (req: Request, res: Response) => {
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

  const idleMinutesRaw = parseIntParam(req.query.idleMinutes);
  const idleMinutes = clampInt(idleMinutesRaw ?? 120, 5, 24 * 60);
  const idleSeconds = idleMinutes * 60;
  const windowStart = new Date(from.getTime() - idleSeconds * 1000);

  const limitRaw = parseIntParam(req.query.limit) ?? 50;
  const offsetRaw = parseIntParam(req.query.offset) ?? 0;
  const limit = clampInt(limitRaw, 1, 200);
  const offset = Math.max(0, Math.trunc(offsetRaw));

  const state = typeof req.query.state === 'string' ? req.query.state : null;
  const stateNormalized = state === 'open' || state === 'closed' ? state : null;

  try {
    const chatFilters: Prisma.Sql[] = [];
    if (channel) chatFilters.push(Prisma.sql`AND c."channel" = ${channel}`);
    if (organizationPhoneId) chatFilters.push(Prisma.sql`AND c."organizationPhoneId" = ${organizationPhoneId}`);
    if (assignedUserId !== null) chatFilters.push(Prisma.sql`AND c."assignedUserId" = ${assignedUserId}`);
    const chatFiltersSql = chatFilters.length ? Prisma.join(chatFilters, ' ') : Prisma.empty;

    const stateFilterSql =
      stateNormalized === 'open'
        ? Prisma.sql`AND EXTRACT(EPOCH FROM (${to} - j.last_at)) <= ${idleSeconds}`
        : stateNormalized === 'closed'
          ? Prisma.sql`AND EXTRACT(EPOCH FROM (${to} - j.last_at)) > ${idleSeconds}`
          : Prisma.empty;

    const baseCteSql = Prisma.sql`
      WITH msgs AS (
        SELECT m."chatId" AS chat_id,
               m."timestamp" AS ts,
               m."fromMe" AS from_me,
               m."senderUserId" AS sender_user_id
        FROM "Message" m
        JOIN "Chat" c ON c."id" = m."chatId"
        WHERE m."organizationId" = ${organizationId}
          AND m."timestamp" >= ${windowStart}
          AND m."timestamp" <= ${to}
          AND c."organizationId" = ${organizationId}
          ${chatFiltersSql}
      ),
      ordered AS (
        SELECT *,
               LAG(ts) OVER (PARTITION BY chat_id ORDER BY ts) AS prev_ts
        FROM msgs
      ),
      marked AS (
        SELECT *,
               CASE
                 WHEN prev_ts IS NULL THEN 1
                 WHEN EXTRACT(EPOCH FROM (ts - prev_ts)) > ${idleSeconds} THEN 1
                 ELSE 0
               END AS is_new
        FROM ordered
      ),
      sess AS (
        SELECT *,
               SUM(is_new) OVER (PARTITION BY chat_id ORDER BY ts) AS session_no
        FROM marked
      ),
      bounds AS (
        SELECT chat_id,
               session_no,
               MIN(ts) AS started_at,
               MAX(ts) AS last_at,
               MIN(ts) FILTER (WHERE from_me = false) AS first_inbound_at
        FROM sess
        GROUP BY chat_id, session_no
      ),
      activity AS (
        SELECT chat_id,
               session_no,
               BOOL_OR(ts >= ${from} AND ts <= ${to}) AS has_in_period
        FROM sess
        GROUP BY chat_id, session_no
      ),
      replies AS (
        SELECT b.chat_id,
               b.session_no,
               r.first_reply_at,
               r.first_reply_user_id
        FROM bounds b
        LEFT JOIN LATERAL (
          SELECT s2.ts AS first_reply_at,
                 s2.sender_user_id AS first_reply_user_id
          FROM sess s2
          WHERE s2.chat_id = b.chat_id
            AND s2.session_no = b.session_no
            AND s2.sender_user_id IS NOT NULL
            AND b.first_inbound_at IS NOT NULL
            AND s2.ts >= b.first_inbound_at
            AND s2.ts <= ${to}
          ORDER BY s2.ts ASC
          LIMIT 1
        ) r ON TRUE
      ),
      joined AS (
        SELECT b.chat_id,
               b.session_no,
               b.started_at,
               b.last_at,
               b.first_inbound_at,
               a.has_in_period,
               rp.first_reply_at,
               rp.first_reply_user_id
        FROM bounds b
        JOIN activity a ON a.chat_id = b.chat_id AND a.session_no = b.session_no
        JOIN replies rp ON rp.chat_id = b.chat_id AND rp.session_no = b.session_no
      )
    `;

    const countSql = Prisma.sql`
      ${baseCteSql}
      SELECT COUNT(*)::int AS total
      FROM joined j
      JOIN "Chat" c ON c."id" = j.chat_id
      WHERE j.has_in_period = true
        ${stateFilterSql};
    `;

    const listSql = Prisma.sql`
      ${baseCteSql}
      SELECT
        j.chat_id AS "chatId",
        j.session_no AS "sessionNo",
        j.started_at AS "startedAt",
        j.last_at AS "lastAt",
        (EXTRACT(EPOCH FROM (${to} - j.last_at)) <= ${idleSeconds}) AS "isOpenAtEnd",
        c."channel" AS "channel",
        c."organizationPhoneId" AS "organizationPhoneId",
        c."assignedUserId" AS "assignedUserId",
        c."status" AS "chatStatus",
        j.first_inbound_at AS "firstInboundAt",
        j.first_reply_at AS "firstReplyAt",
        j.first_reply_user_id AS "firstReplyUserId",
        CASE
          WHEN j.first_inbound_at IS NULL OR j.first_reply_at IS NULL THEN NULL
          ELSE EXTRACT(EPOCH FROM (j.first_reply_at - j.first_inbound_at))
        END AS "firstResponseSeconds"
      FROM joined j
      JOIN "Chat" c ON c."id" = j.chat_id
      WHERE j.has_in_period = true
        ${stateFilterSql}
      ORDER BY j.last_at DESC
      LIMIT ${limit}
      OFFSET ${offset};
    `;

    const [countRows, listRows] = await Promise.all([
      prisma.$queryRaw<any[]>(countSql),
      prisma.$queryRaw<any[]>(listSql),
    ]);

    const total = Number(countRows?.[0]?.total ?? 0);

    res.json({
      range: {
        from: from.toISOString(),
        to: to.toISOString(),
      },
      filters: {
        channel: channel ?? null,
        organizationPhoneId: organizationPhoneId ?? null,
        assignedUserId: assignedUserId ?? null,
        state: stateNormalized,
      },
      tickets: (listRows ?? []).map((r) => ({
        id: `${r.chatId}:${r.sessionNo}`,
        chatId: Number(r.chatId),
        sessionNo: Number(r.sessionNo),
        startedAt: r.startedAt ? new Date(r.startedAt).toISOString() : null,
        lastAt: r.lastAt ? new Date(r.lastAt).toISOString() : null,
        isOpenAtEnd: Boolean(r.isOpenAtEnd),
        channel: r.channel ?? null,
        organizationPhoneId: r.organizationPhoneId === null || r.organizationPhoneId === undefined ? null : Number(r.organizationPhoneId),
        assignedUserId: r.assignedUserId === null || r.assignedUserId === undefined ? null : Number(r.assignedUserId),
        chatStatus: r.chatStatus ?? null,
        firstInboundAt: r.firstInboundAt ? new Date(r.firstInboundAt).toISOString() : null,
        firstReplyAt: r.firstReplyAt ? new Date(r.firstReplyAt).toISOString() : null,
        firstReplyUserId:
          r.firstReplyUserId === null || r.firstReplyUserId === undefined ? null : Number(r.firstReplyUserId),
        firstResponseSeconds:
          r.firstResponseSeconds === null || r.firstResponseSeconds === undefined ? null : Number(r.firstResponseSeconds),
      })),
      pagination: {
        total,
        limit,
        offset,
      },
    });
  } catch (error: any) {
    logger.error({ err: error }, '[listAnalyticsTickets] Ошибка получения списка тикетов аналитики');
    res.status(500).json({ error: 'Ошибка получения списка тикетов аналитики', details: error.message });
  }
};
