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
