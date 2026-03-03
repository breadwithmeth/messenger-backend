import pino, { Logger } from 'pino';
import {
  mapWorkforceUpstreamError,
  UpstreamUnavailableError,
} from './errors';
import {
  EmployeeDto,
  PresenceStatus,
  ShiftDto,
  SyncEmployeeRequest,
  PresenceHistoryItem,
} from './types';

export type FetchLike = (
  input: string,
  init?: RequestInit
) => Promise<Response>;

export type WorkforceClientConfig = {
  baseUrl: string;
  timeoutMs: number;
  retryCount: number;
  retryBaseDelayMs: number;
};

export type RequestContext = {
  requestId?: string;
};

export interface ServiceTokenProvider {
  getToken(): Promise<string>;
}

export class WorkforceClient {
  private readonly config: WorkforceClientConfig;
  private readonly tokenProvider: ServiceTokenProvider;
  private readonly fetchImpl: FetchLike;
  private readonly logger: Logger;

  constructor(args: {
    config: WorkforceClientConfig;
    tokenProvider: ServiceTokenProvider;
    fetchImpl?: FetchLike;
    logger?: Logger;
  }) {
    this.config = {
      ...args.config,
      baseUrl: args.config.baseUrl.replace(/\/$/, ''),
    };
    this.tokenProvider = args.tokenProvider;
    this.fetchImpl = args.fetchImpl ?? fetch;
    this.logger = args.logger ?? pino({ level: 'info' });
  }

  syncEmployee(payload: SyncEmployeeRequest, ctx?: RequestContext): Promise<EmployeeDto> {
    return this.request<EmployeeDto>({
      method: 'POST',
      path: '/internal/employees/sync',
      body: payload,
      ctx,
    });
  }

  getEmployeeByKeycloakId(keycloakId: string, ctx?: RequestContext): Promise<EmployeeDto> {
    return this.request<EmployeeDto>({
      method: 'GET',
      path: `/internal/employees/${encodeURIComponent(keycloakId)}`,
      ctx,
    });
  }

  listEmployees(ctx?: RequestContext): Promise<EmployeeDto[]> {
    return this.request<EmployeeDto[]>({
      method: 'GET',
      path: '/internal/employees',
      ctx,
    });
  }

  startShift(employeeId: string, ctx?: RequestContext): Promise<ShiftDto> {
    return this.request<ShiftDto>({
      method: 'POST',
      path: `/internal/employees/${encodeURIComponent(employeeId)}/shifts/start`,
      ctx,
    });
  }

  stopShift(employeeId: string, ctx?: RequestContext): Promise<ShiftDto> {
    return this.request<ShiftDto>({
      method: 'POST',
      path: `/internal/employees/${encodeURIComponent(employeeId)}/shifts/stop`,
      ctx,
    });
  }

  getShifts(employeeId: string, ctx?: RequestContext): Promise<ShiftDto[]> {
    return this.request<ShiftDto[]>({
      method: 'GET',
      path: `/internal/employees/${encodeURIComponent(employeeId)}/shifts`,
      ctx,
    });
  }

  setPresence(employeeId: string, status: PresenceStatus, ctx?: RequestContext): Promise<EmployeeDto> {
    return this.request<EmployeeDto>({
      method: 'PATCH',
      path: `/internal/employees/${encodeURIComponent(employeeId)}/presence`,
      body: { status },
      ctx,
    });
  }

  getPresenceHistory(employeeId: string, limit = 50, ctx?: RequestContext): Promise<PresenceHistoryItem[]> {
    const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
    return this.request<PresenceHistoryItem[]>({
      method: 'GET',
      path: `/internal/employees/${encodeURIComponent(employeeId)}/presence-history?limit=${safeLimit}`,
      ctx,
    });
  }

  private async request<T>(args: {
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
    path: string;
    body?: unknown;
    ctx?: RequestContext;
  }): Promise<T> {
    const url = `${this.config.baseUrl}${args.path}`;

    let lastError: unknown;
    for (let attempt = 0; attempt <= this.config.retryCount; attempt++) {
      const isRetry = attempt > 0;
      const startedAt = Date.now();
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const token = await this.tokenProvider.getToken();
        const headers: Record<string, string> = {
          accept: 'application/json',
          authorization: `Bearer ${token}`,
        };
        if (args.body !== undefined) {
          headers['content-type'] = 'application/json';
        }

        const res = await this.fetchImpl(url, {
          method: args.method,
          headers,
          body: args.body === undefined ? undefined : JSON.stringify(args.body),
          signal: controller.signal,
        });

        const latencyMs = Date.now() - startedAt;
        const statusCode = res.status;

        if (res.ok) {
          const payload = (await safeReadJson(res)) as T;
          this.logger.info(
            {
              requestId: args.ctx?.requestId,
              endpoint: args.path,
              method: args.method,
              statusCode,
              latencyMs,
              retryCount: attempt,
            },
            'Workforce request success'
          );
          return payload;
        }

        const responseBody = await safeReadJson(res);

        if (statusCode >= 500 && attempt < this.config.retryCount) {
          this.logger.warn(
            {
              requestId: args.ctx?.requestId,
              endpoint: args.path,
              method: args.method,
              statusCode,
              latencyMs,
              retryCount: attempt,
            },
            'Workforce 5xx; retrying'
          );
          await sleepMs(getBackoffMs(this.config.retryBaseDelayMs, attempt));
          continue;
        }

        this.logger.warn(
          {
            requestId: args.ctx?.requestId,
            endpoint: args.path,
            method: args.method,
            statusCode,
            latencyMs,
            retryCount: attempt,
          },
          'Workforce request failed'
        );

        throw mapWorkforceUpstreamError({
          statusCode,
          responseBody,
        });
      } catch (err: any) {
        const latencyMs = Date.now() - startedAt;
        lastError = err;

        // Не ретраим 4xx маппленные ошибки
        if (err && typeof err === 'object' && 'statusCode' in err) {
          throw err;
        }

        const isTimeout = err?.name === 'AbortError';
        const isNetwork = isTimeout || err instanceof TypeError;

        if (isNetwork && attempt < this.config.retryCount) {
          this.logger.warn(
            {
              requestId: args.ctx?.requestId,
              endpoint: args.path,
              method: args.method,
              statusCode: undefined,
              latencyMs,
              retryCount: attempt,
              timeout: isTimeout,
            },
            'Workforce network/timeout error; retrying'
          );
          await sleepMs(getBackoffMs(this.config.retryBaseDelayMs, attempt));
          continue;
        }

        if (err instanceof UpstreamUnavailableError) {
          throw err;
        }

        throw mapWorkforceUpstreamError({
          statusCode: undefined,
          responseBody: undefined,
          cause: err,
        });
      } finally {
        clearTimeout(timeout);
      }
    }

    throw mapWorkforceUpstreamError({
      statusCode: undefined,
      responseBody: undefined,
      cause: lastError,
    });
  }
}

function getBackoffMs(baseDelayMs: number, attempt: number): number {
  const exp = baseDelayMs * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * baseDelayMs);
  return exp + jitter;
}

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function safeReadJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
