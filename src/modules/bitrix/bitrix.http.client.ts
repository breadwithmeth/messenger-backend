import axios, { AxiosError, AxiosInstance, AxiosRequestConfig } from 'axios';
import pino from 'pino';
import { bitrixAuthService } from './bitrix.auth.service';

const logger = pino({ level: process.env.LOG_LEVEL || 'info' });

function isNetworkError(error: unknown): boolean {
  const axiosError = error as AxiosError;
  return Boolean(axiosError?.code) && !axiosError?.response;
}

function extractBitrixError(data: any): string | null {
  const errorCode = data?.error;
  if (!errorCode) {
    return null;
  }

  return String(errorCode).toLowerCase();
}

export class BitrixHttpClient {
  private readonly client: AxiosInstance;
  private readonly rateLimitMs: number;
  private lastCallTs = 0;

  constructor(domain: string) {
    this.rateLimitMs = Number(process.env.BITRIX_RATE_LIMIT_MS || 200);

    this.client = axios.create({
      baseURL: `https://${domain}/rest/`,
      timeout: 15000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  async post<TResponse>(method: string, payload: unknown): Promise<TResponse> {
    return this.executeWithRetry<TResponse>(method, payload, {
      retryCount: 3,
    });
  }

  private async executeWithRetry<TResponse>(
    method: string,
    payload: unknown,
    options: { retryCount: number },
    retryIndex = 0,
  ): Promise<TResponse> {
    const startedAt = Date.now();

    const waitMs = Math.max(0, this.lastCallTs + this.rateLimitMs - Date.now());
    if (waitMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    this.lastCallTs = Date.now();

    const maxRetries = options.retryCount;

    try {
      const accessToken = await bitrixAuthService.getValidAccessToken();
      const config: AxiosRequestConfig = {
        params: {
          auth: accessToken,
        },
      };

      logger.info({ method }, '[BitrixHttpClient] Request started');
      const { data } = await this.client.post<TResponse>(method, payload, config);

      logger.info({ method, durationMs: Date.now() - startedAt }, '[BitrixHttpClient] Request completed');

      return data;
    } catch (error: unknown) {
      const axiosError = error as AxiosError;
      const status = axiosError?.response?.status;
      const responseData = axiosError?.response?.data as any;
      const bitrixError = extractBitrixError(responseData);
      const invalidToken = status === 401 || bitrixError === 'invalid_token' || bitrixError === 'expired_token';

      if (invalidToken && retryIndex < 1) {
        logger.warn({ method, status, bitrixError }, '[BitrixHttpClient] Token expired, refreshing and retrying');
        await bitrixAuthService.refreshAccessToken();
        return this.executeWithRetry(method, payload, options, retryIndex + 1);
      }

      if (isNetworkError(error) && retryIndex < maxRetries) {
        const delayMs = 300 * 2 ** retryIndex;
        logger.warn({ method, retryIndex, delayMs }, '[BitrixHttpClient] Network error, retrying');
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        return this.executeWithRetry(method, payload, options, retryIndex + 1);
      }

      logger.error(
        {
          method,
          durationMs: Date.now() - startedAt,
          status,
          bitrixError,
          message: axiosError?.message,
        },
        '[BitrixHttpClient] Request failed',
      );

      throw error;
    }
  }
}
