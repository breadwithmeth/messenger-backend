export type WorkforceConfig = {
  empBaseUrl: string;
  keycloakBaseUrl: string;
  keycloakRealm: string;
  serviceClientId: string;
  serviceClientSecret: string;
  httpTimeoutMs: number;
  httpRetryCount: number;
  httpRetryBaseDelayMs: number;
};

function parseIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid env ${name}=${raw}; must be a positive integer`);
  }
  return parsed;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

let cached: WorkforceConfig | null = null;

export function getWorkforceConfig(): WorkforceConfig {
  if (cached) return cached;

  cached = {
    empBaseUrl: requireEnv('EMP_BASE_URL').replace(/\/$/, ''),
    keycloakBaseUrl: requireEnv('KEYCLOAK_BASE_URL').replace(/\/$/, ''),
    keycloakRealm: process.env.KEYCLOAK_REALM || 'naliv-prod',
    serviceClientId: requireEnv('BM_SERVICE_CLIENT_ID'),
    serviceClientSecret: requireEnv('BM_SERVICE_CLIENT_SECRET'),
    httpTimeoutMs: parseIntEnv('HTTP_TIMEOUT_MS', 4000),
    httpRetryCount: parseIntEnv('HTTP_RETRY_COUNT', 2),
    httpRetryBaseDelayMs: parseIntEnv('HTTP_RETRY_BASE_DELAY_MS', 200),
  };

  return cached;
}
