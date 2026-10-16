// src/config/aiBotConfig.ts
//
// Конфигурация AI-ботов Telegram:
//  - AI-провайдер (Ollama-совместимый сервер nssl.drawbridge.kz)
//  - Публичный API "Налив" (геокодер адресов, магазины, товары)

export type AiBotConfig = {
  aiBaseUrl: string;
  aiApiKey: string;
  aiModel: string;
  nalivBaseUrl: string;
  httpTimeoutMs: number;
  httpRetryCount: number;
  httpRetryBaseDelayMs: number;
};

function parsePositiveIntEnv(name: string, defaultValue: number): number {
  const raw = process.env[name];
  if (!raw) return defaultValue;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid env ${name}=${raw}; must be a positive integer`);
  }
  return parsed;
}

let cached: AiBotConfig | null = null;

export function getAiBotConfig(): AiBotConfig {
  if (cached) return cached;

  cached = {
    aiBaseUrl: (process.env.AI_BOT_BASE_URL || 'https://nssl.drawbridge.kz').replace(/\/$/, ''),
    aiApiKey: process.env.AI_BOT_API_KEY || '',
    aiModel: process.env.AI_BOT_MODEL || 'qwen2.5:7b',
    nalivBaseUrl: (process.env.NALIV_API_BASE_URL || 'https://njt25.naliv.kz').replace(/\/$/, ''),
    httpTimeoutMs: parsePositiveIntEnv('AI_BOT_HTTP_TIMEOUT_MS', 60000),
    httpRetryCount: parsePositiveIntEnv('AI_BOT_HTTP_RETRY_COUNT', 2),
    httpRetryBaseDelayMs: parsePositiveIntEnv('AI_BOT_HTTP_RETRY_BASE_DELAY_MS', 300),
  };

  return cached;
}

// Для тестов
export function resetAiBotConfigCache(): void {
  cached = null;
}
