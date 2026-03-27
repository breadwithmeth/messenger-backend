import axios, { AxiosError } from 'axios';
import pino from 'pino';
import {
  BitrixOauthTokenResponse,
  BitrixTokenRecord,
  BitrixTokenUpsertInput,
} from './bitrix.types';
import { BitrixTokenRepository } from './bitrix.token.repository';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });
const OAUTH_BASE_URL = 'https://oauth.bitrix.info/oauth/token/';
const EXPIRY_SKEW_MS = 60_000;

function isNetworkError(error: unknown): boolean {
  const axiosError = error as AxiosError;
  return Boolean(axiosError?.code) && !axiosError?.response;
}

export class BitrixAuthService {
  private static instance: BitrixAuthService;
  private readonly repository = new BitrixTokenRepository();
  private tokenCache: BitrixTokenRecord | null = null;
  private refreshPromise: Promise<BitrixTokenRecord> | null = null;

  private constructor() {}

  static getInstance(): BitrixAuthService {
    if (!BitrixAuthService.instance) {
      BitrixAuthService.instance = new BitrixAuthService();
    }
    return BitrixAuthService.instance;
  }

  getDomain(): string {
    const domain = process.env.BITRIX_DOMAIN?.trim();
    if (!domain) {
      throw new Error('BITRIX_DOMAIN is not configured');
    }
    return domain;
  }

  getAuthorizeUrl(state?: string): string {
    const domain = this.getDomain();
    const clientId = process.env.BITRIX_CLIENT_ID?.trim();
    const redirectUri = process.env.BITRIX_REDIRECT_URI?.trim();

    if (!clientId || !redirectUri) {
      throw new Error('BITRIX_CLIENT_ID or BITRIX_REDIRECT_URI is not configured');
    }

    const url = new URL(`https://${domain}/oauth/authorize/`);
    url.searchParams.set('client_id', clientId);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('redirect_uri', redirectUri);
    if (state) {
      url.searchParams.set('state', state);
    }

    return url.toString();
  }

  async exchangeCode(code: string): Promise<BitrixTokenRecord> {
    if (!code?.trim()) {
      throw new Error('Authorization code is required');
    }

    const payload = await this.fetchToken({
      grant_type: 'authorization_code',
      code: code.trim(),
    });

    const saved = await this.persistTokenFromOauth(payload);
    logger.info({ domain: saved.domain, expiresAt: saved.expiresAt.toISOString() }, '[BitrixAuthService] Token obtained via OAuth code');

    return saved;
  }

  async getValidAccessToken(forceRefresh = false): Promise<string> {
    const token = await this.getValidToken(forceRefresh);
    return token.accessToken;
  }

  async getValidToken(forceRefresh = false): Promise<BitrixTokenRecord> {
    const current = await this.getCachedOrStoredToken();

    if (!current) {
      throw new Error('Bitrix token is not connected. Open /integrations/bitrix/connect first.');
    }

    if (!forceRefresh && !this.isExpired(current.expiresAt)) {
      return current;
    }

    const refreshed = await this.refreshAccessToken(current.refreshToken);
    return refreshed;
  }

  async refreshAccessToken(refreshToken?: string): Promise<BitrixTokenRecord> {
    if (this.refreshPromise) {
      return this.refreshPromise;
    }

    this.refreshPromise = this.doRefresh(refreshToken)
      .finally(() => {
        this.refreshPromise = null;
      });

    return this.refreshPromise;
  }

  async invalidateCache(): Promise<void> {
    this.tokenCache = null;
  }

  private async doRefresh(refreshToken?: string): Promise<BitrixTokenRecord> {
    const existing = await this.getCachedOrStoredToken();
    const tokenToUse = refreshToken || existing?.refreshToken;

    if (!tokenToUse) {
      throw new Error('Refresh token is not available');
    }

    const payload = await this.fetchToken({
      grant_type: 'refresh_token',
      refresh_token: tokenToUse,
    });

    const saved = await this.persistTokenFromOauth(payload);
    logger.info({ domain: saved.domain, expiresAt: saved.expiresAt.toISOString() }, '[BitrixAuthService] Token refreshed');

    return saved;
  }

  private async getCachedOrStoredToken(): Promise<BitrixTokenRecord | null> {
    const domain = this.getDomain();

    if (this.tokenCache && this.tokenCache.domain === domain) {
      return this.tokenCache;
    }

    const token = await this.repository.getByDomain(domain);
    this.tokenCache = token;
    return token;
  }

  private isExpired(expiresAt: Date): boolean {
    return expiresAt.getTime() - Date.now() <= EXPIRY_SKEW_MS;
  }

  private async persistTokenFromOauth(payload: BitrixOauthTokenResponse): Promise<BitrixTokenRecord> {
    if (!payload?.access_token || !payload?.refresh_token || !payload?.expires_in) {
      throw new Error(`Invalid Bitrix OAuth response: ${payload?.error_description || payload?.error || 'missing fields'}`);
    }

    const domain = this.getDomain();
    const expiresAt = new Date(Date.now() + Number(payload.expires_in) * 1000);

    const input: BitrixTokenUpsertInput = {
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt,
      domain,
    };

    const saved = await this.repository.upsertByDomain(input);
    this.tokenCache = saved;

    return saved;
  }

  private async fetchToken(body: Record<string, string>): Promise<BitrixOauthTokenResponse> {
    const clientId = process.env.BITRIX_CLIENT_ID?.trim();
    const clientSecret = process.env.BITRIX_CLIENT_SECRET?.trim();

    if (!clientId || !clientSecret) {
      throw new Error('BITRIX_CLIENT_ID or BITRIX_CLIENT_SECRET is not configured');
    }

    const form = new URLSearchParams({
      ...body,
      client_id: clientId,
      client_secret: clientSecret,
    });

    const maxAttempts = 3;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt += 1;
      try {
        const { data } = await axios.post<BitrixOauthTokenResponse>(OAUTH_BASE_URL, form.toString(), {
          timeout: 15000,
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        });

        if (data?.error) {
          throw new Error(`Bitrix OAuth error: ${data.error_description || data.error}`);
        }

        return data;
      } catch (error: unknown) {
        const canRetry = isNetworkError(error) && attempt < maxAttempts;
        if (!canRetry) {
          const axiosError = error as AxiosError;
          logger.error(
            {
              attempt,
              status: axiosError?.response?.status,
              message: axiosError?.message,
              oauthError: (axiosError?.response?.data as any)?.error,
            },
            '[BitrixAuthService] OAuth request failed',
          );
          throw error;
        }

        const delayMs = 300 * 2 ** (attempt - 1);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }

    throw new Error('Failed to request Bitrix OAuth token');
  }
}

export const bitrixAuthService = BitrixAuthService.getInstance();
