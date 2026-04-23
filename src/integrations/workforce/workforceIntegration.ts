import pino, { Logger } from 'pino';
import { getWorkforceConfig } from '../../config/workforceConfig';
import { KeycloakClientCredentialsTokenProvider } from './tokenProvider';
import { WorkforceClient } from './workforceClient';
import { SyncEmployeeRequest } from './types';

export type AuthClaims = {
  keycloakId?: string;
  sub?: string;
  email?: string;
  username?: string;
  preferred_username?: string;
};

let singleton: WorkforceClient | null = null;
const baseLogger = pino({ level: process.env.APP_LOG_LEVEL || 'silent' });

export function getWorkforceClient(): WorkforceClient {
  if (singleton) return singleton;
  const cfg = getWorkforceConfig();
  const tokenProvider = new KeycloakClientCredentialsTokenProvider(
    {
      keycloakBaseUrl: cfg.keycloakBaseUrl,
      realm: cfg.keycloakRealm,
      clientId: cfg.serviceClientId,
      clientSecret: cfg.serviceClientSecret,
      timeoutMs: cfg.httpTimeoutMs,
    },
    baseLogger
  );

  singleton = new WorkforceClient({
    config: {
      baseUrl: cfg.empBaseUrl,
      timeoutMs: cfg.httpTimeoutMs,
      retryCount: cfg.httpRetryCount,
      retryBaseDelayMs: cfg.httpRetryBaseDelayMs,
    },
    tokenProvider,
    logger: baseLogger,
  });

  return singleton;
}

export async function syncEmployeeFromClaims(args: {
  claims: AuthClaims;
  ip?: string;
  requestId?: string;
  logger?: Logger;
}): Promise<void> {
  const logger = args.logger ?? baseLogger;

  const keycloakId = args.claims.keycloakId ?? args.claims.sub;
  if (!keycloakId) return;

  const payload: SyncEmployeeRequest = {
    keycloakId,
    email: args.claims.email,
    username: args.claims.username ?? args.claims.preferred_username,
    ip: args.ip,
  };

  try {
    const client = getWorkforceClient();
    await client.syncEmployee(payload, { requestId: args.requestId });
  } catch (err) {
    // Не ломаем основной flow bm из-за workforce проблем.
    logger.warn(
      {
        requestId: args.requestId,
        err,
      },
      'Workforce syncEmployee failed'
    );
  }
}
