import pino, { Logger } from 'pino';

export type ServiceTokenProviderConfig = {
  keycloakBaseUrl: string;
  realm: string;
  clientId: string;
  clientSecret: string;
  timeoutMs: number;
};

type TokenState = {
  accessToken: string;
  expiresAtMs: number;
};

export class KeycloakClientCredentialsTokenProvider {
  private readonly config: ServiceTokenProviderConfig;
  private readonly logger: Logger;
  private tokenState: TokenState | null = null;
  private refreshPromise: Promise<TokenState> | null = null;

  constructor(config: ServiceTokenProviderConfig, logger?: Logger) {
    this.config = config;
    this.logger = logger ?? pino({ level: process.env.APP_LOG_LEVEL || 'silent' });
  }

  async getToken(): Promise<string> {
    const now = Date.now();
    if (this.tokenState && now < this.tokenState.expiresAtMs - 30_000) {
      return this.tokenState.accessToken;
    }

    if (this.refreshPromise) {
      const state = await this.refreshPromise;
      return state.accessToken;
    }

    this.refreshPromise = this.refreshToken();
    try {
      const state = await this.refreshPromise;
      this.tokenState = state;
      return state.accessToken;
    } finally {
      this.refreshPromise = null;
    }
  }

  private async refreshToken(): Promise<TokenState> {
    const tokenUrl = `${this.config.keycloakBaseUrl}/realms/${encodeURIComponent(
      this.config.realm
    )}/protocol/openid-connect/token`;

    const body = new URLSearchParams();
    body.set('grant_type', 'client_credentials');
    body.set('client_id', this.config.clientId);
    body.set('client_secret', this.config.clientSecret);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);

    const startedAt = Date.now();
    try {
      const res = await fetch(tokenUrl, {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          accept: 'application/json',
        },
        body,
        signal: controller.signal,
      });

      const latencyMs = Date.now() - startedAt;
      if (!res.ok) {
        const text = await safeReadText(res);
        this.logger.warn(
          {
            endpoint: 'keycloak.token',
            method: 'POST',
            statusCode: res.status,
            latencyMs,
          },
          'Keycloak token request failed'
        );
        throw new Error(`Keycloak token request failed with status ${res.status}: ${text}`);
      }

      const json = (await res.json()) as {
        access_token?: string;
        expires_in?: number;
        token_type?: string;
      };

      if (!json.access_token || !json.expires_in) {
        throw new Error('Keycloak token response missing access_token/expires_in');
      }

      return {
        accessToken: json.access_token,
        expiresAtMs: Date.now() + json.expires_in * 1000,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeReadText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}
