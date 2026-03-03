import { Response } from 'express';
import { AuthRequest } from '../middlewares/authMiddleware';
import { getWorkforceClient } from '../integrations/workforce/workforceIntegration';
import {
  UpstreamAuthError,
  UpstreamBadRequestError,
  UpstreamConflictError,
  UpstreamForbiddenError,
  UpstreamNotFoundError,
  UpstreamUnavailableError,
} from '../integrations/workforce/errors';
import { prisma } from '../config/authStorage';

function getRequestId(req: AuthRequest): string | undefined {
  const raw = req.headers['x-request-id'];
  return Array.isArray(raw) ? raw[0] : raw;
}

function requireKeycloakId(req: AuthRequest): string {
  const keycloakId = req.user?.keycloakId;
  if (!keycloakId) {
    const err: any = new Error('Missing keycloakId in auth claims');
    err.status = 400;
    throw err;
  }
  return keycloakId;
}

function mapUpstreamToHttp(err: unknown): { status: number; body: any } {
  const anyErr = err as any;
  if (anyErr && typeof anyErr === 'object' && typeof anyErr.status === 'number') {
    return { status: anyErr.status, body: { error: anyErr.message || 'Error' } };
  }

  if (err instanceof UpstreamNotFoundError) return { status: 404, body: { error: err.safeMessage } };
  if (err instanceof UpstreamConflictError) return { status: 409, body: { error: err.safeMessage } };
  if (err instanceof UpstreamUnavailableError) return { status: 503, body: { error: err.safeMessage } };
  if (err instanceof UpstreamAuthError) return { status: 502, body: { error: err.safeMessage } };
  if (err instanceof UpstreamForbiddenError) return { status: 502, body: { error: err.safeMessage } };
  if (err instanceof UpstreamBadRequestError) return { status: 502, body: { error: err.safeMessage } };
  return { status: 500, body: { error: 'Internal Server Error' } };
}

function normalizeStatus(raw: string): string {
  return raw.trim().toUpperCase();
}

function parseDate(raw: unknown): Date | null {
  if (typeof raw !== 'string') return null;
  const d = new Date(raw);
  return isNaN(d.getTime()) ? null : d;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  const v = Math.trunc(value);
  return Math.min(max, Math.max(min, v));
}

// ===== Presence heartbeat (auto ONLINE + delayed OFFLINE) =====
const presenceOfflineTimers = new Map<string, NodeJS.Timeout>();
const presenceInactivityMs = Number(process.env.PRESENCE_INACTIVITY_MS || 300000); // 5 минут по умолчанию

async function setPresenceSafe(employeeId: string, status: string, req: AuthRequest) {
  const client = getWorkforceClient();
  const normalizedStatus = normalizeStatus(status);
  return client.setPresence(employeeId, normalizedStatus, { requestId: getRequestId(req) });
}

function scheduleOffline(employeeId: string, req: AuthRequest) {
  const existing = presenceOfflineTimers.get(employeeId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    presenceOfflineTimers.delete(employeeId);
    void setPresenceSafe(employeeId, 'offline', req).catch(() => {
      // intentionally ignore errors on background offline set
    });
  }, presenceInactivityMs);

  presenceOfflineTimers.set(employeeId, timer);
}

export async function presenceHeartbeat(req: AuthRequest, res: Response) {
  try {
    const keycloakId = requireKeycloakId(req);
    const client = getWorkforceClient();
    const employee = await client.getEmployeeByKeycloakId(keycloakId, { requestId: getRequestId(req) });

    await setPresenceSafe(employee.id, 'online', req);
    scheduleOffline(employee.id, req);

    return res.status(200).json({ success: true, status: 'online', employeeId: employee.id, ttlMs: presenceInactivityMs });
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function setEmployeePresenceInternal(req: AuthRequest, res: Response) {
  try {
    const { status } = req.body ?? {};
    const employeeId = req.params.id;

    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'status is required' });
    }

    if (!employeeId) {
      return res.status(400).json({ error: 'employeeId is required' });
    }

    const updated = await setPresenceSafe(employeeId, status, req);
    return res.status(200).json(updated);
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function getMyEmployee(req: AuthRequest, res: Response) {
  try {
    const keycloakId = requireKeycloakId(req);
    const client = getWorkforceClient();
    const employee = await client.getEmployeeByKeycloakId(keycloakId, { requestId: getRequestId(req) });
    return res.status(200).json(employee);
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function startMyShift(req: AuthRequest, res: Response) {
  try {
    const keycloakId = requireKeycloakId(req);
    const client = getWorkforceClient();
    const employee = await client.getEmployeeByKeycloakId(keycloakId, { requestId: getRequestId(req) });
    const shift = await client.startShift(employee.id, { requestId: getRequestId(req) });
    return res.status(200).json(shift);
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function stopMyShift(req: AuthRequest, res: Response) {
  try {
    const keycloakId = requireKeycloakId(req);
    const client = getWorkforceClient();
    const employee = await client.getEmployeeByKeycloakId(keycloakId, { requestId: getRequestId(req) });
    const shift = await client.stopShift(employee.id, { requestId: getRequestId(req) });
    return res.status(200).json(shift);
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function listMyShifts(req: AuthRequest, res: Response) {
  try {
    const keycloakId = requireKeycloakId(req);
    const client = getWorkforceClient();
    const employee = await client.getEmployeeByKeycloakId(keycloakId, { requestId: getRequestId(req) });
    const shifts = await client.getShifts(employee.id, { requestId: getRequestId(req) });
    return res.status(200).json(shifts);
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function setMyPresence(req: AuthRequest, res: Response) {
  try {
    const { status } = req.body ?? {};
    if (!status || typeof status !== 'string') {
      return res.status(400).json({ error: 'status is required' });
    }

    const keycloakId = requireKeycloakId(req);
    const client = getWorkforceClient();
    const employee = await client.getEmployeeByKeycloakId(keycloakId, { requestId: getRequestId(req) });
    const updated = await setPresenceSafe(employee.id, status, req);
    return res.status(200).json(updated);
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function listEmployees(req: AuthRequest, res: Response) {
  try {
    const client = getWorkforceClient();
    const employees = await client.listEmployees({ requestId: getRequestId(req) });
    return res.status(200).json(employees);
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}

export async function getMyActivityStats(req: AuthRequest, res: Response) {
  const organizationId = res.locals.organizationId as number | undefined;
  const userId = res.locals.userId as number | undefined;
  if (!organizationId || !userId) {
    return res.status(401).json({ error: 'Несанкционированный доступ' });
  }

  const now = new Date();
  const from = parseDate(req.query.from) ?? new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const to = parseDate(req.query.to) ?? now;
  if (from > to) {
    return res.status(400).json({ error: 'Некорректный диапазон дат: from > to' });
  }

  const presenceLimitRaw = Number(req.query.presenceLimit ?? 50);
  const presenceLimit = clampInt(presenceLimitRaw, 1, 200, 50);
  const messagesLimitRaw = Number(req.query.messagesLimit ?? 500);
  const messagesLimit = clampInt(messagesLimitRaw, 1, 2000, 500);

  try {
    const client = getWorkforceClient();
    const keycloakId = requireKeycloakId(req);
    const employee = await client.getEmployeeByKeycloakId(keycloakId, { requestId: getRequestId(req) });

    const [presenceHistory, inboundMessages, outboundMessages, recentMessagesAsc] = await Promise.all([
      client.getPresenceHistory(employee.id, presenceLimit, { requestId: getRequestId(req) }),
      prisma.message.count({
        where: {
          organizationId,
          timestamp: { gte: from, lte: to },
          fromMe: false,
          chat: { organizationId, assignedUserId: userId },
        },
      }),
      prisma.message.count({
        where: {
          organizationId,
          timestamp: { gte: from, lte: to },
          fromMe: true,
          senderUserId: userId,
        },
      }),
      prisma.message.findMany({
        where: {
          organizationId,
          timestamp: { gte: from, lte: to },
          OR: [
            { fromMe: true, senderUserId: userId },
            { fromMe: false, chat: { organizationId, assignedUserId: userId } },
          ],
        },
        select: {
          id: true,
          chatId: true,
          fromMe: true,
          content: true,
          type: true,
          timestamp: true,
          channel: true,
          senderUserId: true,
        },
        orderBy: { timestamp: 'asc' },
        take: messagesLimit,
      }),
    ]);

    const presenceSorted = [...presenceHistory].sort((a: any, b: any) => new Date(a.changedAt).getTime() - new Date(b.changedAt).getTime());
    const messagesBuckets = presenceSorted.map((p) => ({ status: p.status, changedAt: p.changedAt, messages: [] as { id: number; timestamp: Date; direction: 'inbound' | 'outbound'; chatId: number; channel?: string | null }[] }));

    if (messagesBuckets.length > 0) {
      let msgIdx = 0;
      for (let i = 0; i < messagesBuckets.length; i++) {
        const start = new Date(messagesBuckets[i].changedAt).getTime();
        const end = i + 1 < messagesBuckets.length ? new Date(messagesBuckets[i + 1].changedAt).getTime() : to.getTime();
        while (msgIdx < recentMessagesAsc.length) {
          const m = recentMessagesAsc[msgIdx];
          const t = new Date(m.timestamp).getTime();
          if (t < start) {
            msgIdx += 1;
            continue;
          }
          if (t >= end) break;
          messagesBuckets[i].messages.push({
            id: m.id,
            timestamp: m.timestamp,
            direction: m.fromMe ? 'outbound' : 'inbound',
            chatId: m.chatId,
            channel: m.channel,
          });
          msgIdx += 1;
        }
      }
    }

    return res.status(200).json({
      range: { from: from.toISOString(), to: to.toISOString() },
      employee: { id: employee.id, keycloakId: employee.keycloakId, name: employee.username ?? null, email: employee.email ?? null },
      presenceHistory: messagesBuckets,
      messages: {
        inbound: inboundMessages,
        outbound: outboundMessages,
        recent: recentMessagesAsc
          .slice()
          .reverse()
          .map((m) => ({
            id: m.id,
            chatId: m.chatId,
            direction: m.fromMe ? 'outbound' : 'inbound',
            content: m.content,
            type: m.type,
            timestamp: m.timestamp,
            channel: m.channel,
            senderUserId: m.senderUserId,
          })),
      },
    });
  } catch (err) {
    const mapped = mapUpstreamToHttp(err);
    return res.status(mapped.status).json(mapped.body);
  }
}
