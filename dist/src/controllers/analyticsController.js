"use strict";
// src/controllers/analyticsController.ts
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getChatAnalytics = void 0;
const authStorage_1 = require("../config/authStorage");
const client_1 = require("@prisma/client");
const pino_1 = __importDefault(require("pino"));
const logger = (0, pino_1.default)({ level: 'info' });
function parseDateParam(raw) {
    if (!raw || typeof raw !== 'string')
        return null;
    const d = new Date(raw);
    return Number.isFinite(d.getTime()) ? d : null;
}
function parseIntParam(raw) {
    if (raw === undefined || raw === null)
        return null;
    const n = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number(raw);
    return Number.isFinite(n) ? n : null;
}
function clampInt(n, min, max) {
    if (!Number.isFinite(n))
        return min;
    return Math.min(max, Math.max(min, Math.trunc(n)));
}
/**
 * Аналитика по чатам (summary) для организации.
 * GET /api/analytics/chats?from=2026-02-01&to=2026-02-11&channel=whatsapp|telegram&organizationPhoneId=123&assignedUserId=45
 */
const getChatAnalytics = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a, _b, _c, _d, _e, _f, _g, _h, _j, _k, _l, _m, _o;
    const organizationId = res.locals.organizationId;
    if (!organizationId) {
        return res.status(401).json({ error: 'Несанкционированный доступ' });
    }
    const now = new Date();
    const from = (_a = parseDateParam(req.query.from)) !== null && _a !== void 0 ? _a : new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const to = (_b = parseDateParam(req.query.to)) !== null && _b !== void 0 ? _b : now;
    if (from > to) {
        return res.status(400).json({ error: 'Некорректный диапазон дат: from > to' });
    }
    const channel = typeof req.query.channel === 'string' ? req.query.channel : null;
    const organizationPhoneId = parseIntParam(req.query.organizationPhoneId);
    const assignedUserId = parseIntParam(req.query.assignedUserId);
    const idleMinutesRaw = parseIntParam(req.query.idleMinutes);
    const idleMinutes = clampInt(idleMinutesRaw !== null && idleMinutesRaw !== void 0 ? idleMinutesRaw : 120, 5, 24 * 60);
    const idleSeconds = idleMinutes * 60;
    const windowStart = new Date(from.getTime() - idleSeconds * 1000);
    try {
        // Базовые where для Chat
        const chatWhere = {
            organizationId,
        };
        if (channel)
            chatWhere.channel = channel;
        if (organizationPhoneId)
            chatWhere.organizationPhoneId = organizationPhoneId;
        if (assignedUserId !== null)
            chatWhere.assignedUserId = assignedUserId;
        // 1) Чаты: создано за период, активных за период (есть сообщения), распределение по статусам
        const chatsCreatedPromise = authStorage_1.prisma.chat.count({
            where: Object.assign(Object.assign({}, chatWhere), { createdAt: { gte: from, lte: to } }),
        });
        const activeChatsPromise = authStorage_1.prisma.message.findMany({
            where: {
                organizationId,
                timestamp: { gte: from, lte: to },
                chat: chatWhere,
            },
            distinct: ['chatId'],
            select: { chatId: true },
        });
        const byStatusPromise = authStorage_1.prisma.chat.groupBy({
            by: ['status'],
            where: chatWhere,
            _count: true,
        });
        const byChannelPromise = authStorage_1.prisma.chat.groupBy({
            by: ['channel'],
            where: Object.assign({ organizationId }, (channel ? { channel } : {})),
            _count: true,
        });
        // 2) Сообщения за период
        const totalMessagesPromise = authStorage_1.prisma.message.count({
            where: {
                organizationId,
                timestamp: { gte: from, lte: to },
                chat: chatWhere,
            },
        });
        const inboundMessagesPromise = authStorage_1.prisma.message.count({
            where: {
                organizationId,
                timestamp: { gte: from, lte: to },
                fromMe: false,
                chat: chatWhere,
            },
        });
        const outboundMessagesPromise = authStorage_1.prisma.message.count({
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
        const extraChatFilters = [];
        if (channel)
            extraChatFilters.push(client_1.Prisma.sql `AND c."channel" = ${channel}`);
        if (organizationPhoneId)
            extraChatFilters.push(client_1.Prisma.sql `AND c."organizationPhoneId" = ${organizationPhoneId}`);
        if (assignedUserId !== null)
            extraChatFilters.push(client_1.Prisma.sql `AND c."assignedUserId" = ${assignedUserId}`);
        const responseTimeSql = client_1.Prisma.sql `
      WITH first_inbound AS (
        SELECT m."chatId" AS chat_id, MIN(m."timestamp") AS first_inbound
        FROM "Message" m
        JOIN "Chat" c ON c."id" = m."chatId"
        WHERE m."organizationId" = ${organizationId}
          AND m."fromMe" = false
          AND m."timestamp" >= ${from}
          AND m."timestamp" <= ${to}
          AND c."organizationId" = ${organizationId}
          ${client_1.Prisma.join(extraChatFilters, ' ')}
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
        const resolutionTimeSql = client_1.Prisma.sql `
      WITH first_inbound_any AS (
        SELECT m."chatId" AS chat_id, MIN(m."timestamp") AS first_inbound
        FROM "Message" m
        JOIN "Chat" c ON c."id" = m."chatId"
        WHERE m."organizationId" = ${organizationId}
          AND m."fromMe" = false
          AND c."organizationId" = ${organizationId}
          ${client_1.Prisma.join(extraChatFilters, ' ')}
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
        const responseTimePromise = authStorage_1.prisma.$queryRaw(responseTimeSql);
        const resolutionTimePromise = authStorage_1.prisma.$queryRaw(resolutionTimeSql);
        // 4) Тикетизация: один chat => несколько "тикетов", если пауза между любыми сообщениями > idleMinutes.
        // Считаем тикет-сессию по Message timeline в рамках chatId.
        const ticketsSql = client_1.Prisma.sql `
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
          ${client_1.Prisma.join(extraChatFilters, ' ')}
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
        const ticketsPromise = authStorage_1.prisma.$queryRaw(ticketsSql);
        const [chatsCreated, activeChatsRows, byStatus, byChannel, totalMessages, inboundMessages, outboundMessages, responseTimeRows, resolutionTimeRows, ticketsRows,] = yield Promise.all([
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
        const statusStats = {};
        for (const item of byStatus) {
            statusStats[item.status] = item._count;
        }
        const channelStats = {};
        for (const item of byChannel) {
            channelStats[item.channel] = item._count;
        }
        const responseTime = (_c = responseTimeRows === null || responseTimeRows === void 0 ? void 0 : responseTimeRows[0]) !== null && _c !== void 0 ? _c : {};
        const resolutionTime = (_d = resolutionTimeRows === null || resolutionTimeRows === void 0 ? void 0 : resolutionTimeRows[0]) !== null && _d !== void 0 ? _d : {};
        const tickets = (_e = ticketsRows === null || ticketsRows === void 0 ? void 0 : ticketsRows[0]) !== null && _e !== void 0 ? _e : {};
        const activeChats = Array.isArray(activeChatsRows) ? activeChatsRows.length : 0;
        res.json({
            range: {
                from: from.toISOString(),
                to: to.toISOString(),
            },
            filters: {
                channel: channel !== null && channel !== void 0 ? channel : null,
                organizationPhoneId: organizationPhoneId !== null && organizationPhoneId !== void 0 ? organizationPhoneId : null,
                assignedUserId: assignedUserId !== null && assignedUserId !== void 0 ? assignedUserId : null,
            },
            chats: {
                created: chatsCreated,
                active: activeChats,
                byStatus: statusStats,
                byChannel: channelStats,
            },
            tickets: {
                idleMinutes,
                started: Number((_f = tickets.tickets_started) !== null && _f !== void 0 ? _f : 0),
                active: Number((_g = tickets.tickets_active) !== null && _g !== void 0 ? _g : 0),
                openAtEnd: Number((_h = tickets.tickets_open_at_end) !== null && _h !== void 0 ? _h : 0),
                closedByIdleAtEnd: Number((_j = tickets.tickets_closed_by_idle_at_end) !== null && _j !== void 0 ? _j : 0),
                withInbound: Number((_k = tickets.tickets_with_inbound) !== null && _k !== void 0 ? _k : 0),
                withResponse: Number((_l = tickets.tickets_with_response) !== null && _l !== void 0 ? _l : 0),
                firstResponseSeconds: {
                    avg: tickets.avg_first_response_seconds === null || tickets.avg_first_response_seconds === undefined
                        ? null
                        : Number(tickets.avg_first_response_seconds),
                    p50: tickets.p50_first_response_seconds === null || tickets.p50_first_response_seconds === undefined
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
                    chatsWithResponse: Number((_m = responseTime.chats_with_response) !== null && _m !== void 0 ? _m : 0),
                    avg: responseTime.avg_seconds === null || responseTime.avg_seconds === undefined ? null : Number(responseTime.avg_seconds),
                    p50: responseTime.p50_seconds === null || responseTime.p50_seconds === undefined ? null : Number(responseTime.p50_seconds),
                },
                resolutionSeconds: {
                    chatsClosed: Number((_o = resolutionTime.chats_closed) !== null && _o !== void 0 ? _o : 0),
                    avg: resolutionTime.avg_seconds === null || resolutionTime.avg_seconds === undefined ? null : Number(resolutionTime.avg_seconds),
                    p50: resolutionTime.p50_seconds === null || resolutionTime.p50_seconds === undefined ? null : Number(resolutionTime.p50_seconds),
                },
            },
        });
    }
    catch (error) {
        logger.error({ err: error }, '[getChatAnalytics] Ошибка получения аналитики по чатам');
        res.status(500).json({ error: 'Ошибка получения аналитики по чатам', details: error.message });
    }
});
exports.getChatAnalytics = getChatAnalytics;
//# sourceMappingURL=analyticsController.js.map