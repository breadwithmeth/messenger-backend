// src/services/aiChatClient.ts
//
// Клиент AI-провайдера для Telegram AI-ботов.
// Сервер Ollama-совместимый (есть /api/tags), поэтому используется нативный
// Ollama-эндпоинт POST /api/chat (stream: false) с Bearer-токеном.
//
// Конфиг: AI_BOT_BASE_URL, AI_BOT_API_KEY, AI_BOT_MODEL (см. src/config/aiBotConfig.ts)

import axios from 'axios';
import { createLogger } from '../config/logging.js';
import { getAiBotConfig } from '../config/aiBotConfig.js';

const logger = createLogger();

export type AiChatMessage = {
  role: 'system' | 'user' | 'assistant';
  content: string;
};

export class AiChatError extends Error {
  constructor(
    message: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = 'AiChatError';
  }
}

function toAiChatError(error: unknown): AiChatError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const detail =
      typeof error.response?.data === 'string'
        ? error.response.data.slice(0, 300)
        : JSON.stringify(error.response?.data ?? {}).slice(0, 300);
    return new AiChatError(
      `AI API failed: ${error.message}${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`,
      status
    );
  }
  return new AiChatError(`AI API failed: ${(error as Error).message}`);
}

/**
 * Запрос к чат-модели (Ollama /api/chat, без стриминга).
 * @param messages история диалога (system + user/assistant)
 * @param opts.model переопределение модели (по умолчанию AI_BOT_MODEL или aiModel бота)
 * @param opts.temperature температура (по умолчанию 0.2 — важна точность JSON)
 * @param opts.formatJson требовать JSON-вывод (Ollama format: "json")
 */
export async function aiChat(
  messages: AiChatMessage[],
  opts: {
    model?: string;
    temperature?: number;
    formatJson?: boolean;
  } = {}
): Promise<string> {
  const cfg = getAiBotConfig();

  if (!cfg.aiApiKey) {
    throw new AiChatError('AI_BOT_API_KEY не установлен в переменных окружения');
  }

  const model = opts.model || cfg.aiModel;
  const body: Record<string, unknown> = {
    model,
    messages,
    stream: false,
    options: {
      temperature: opts.temperature ?? 0.2,
      num_predict: 1024,
    },
  };
  if (opts.formatJson) {
    body.format = 'json';
  }

  try {
    const response = await axios.post(`${cfg.aiBaseUrl}/api/chat`, body, {
      timeout: cfg.httpTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.aiApiKey}`,
      },
    });

    const content = response.data?.message?.content;
    if (typeof content !== 'string' || !content.trim()) {
      throw new AiChatError('AI не вернул content в ответе /api/chat');
    }

    return content;
  } catch (error) {
    if (error instanceof AiChatError) throw error;
    throw toAiChatError(error);
  }
}

/**
 * Список доступных моделей с сервера (GET /api/tags)
 */
export async function listAiModels(): Promise<{ name: string; size?: number }[]> {
  const cfg = getAiBotConfig();

  if (!cfg.aiApiKey) {
    throw new AiChatError('AI_BOT_API_KEY не установлен в переменных окружения');
  }

  try {
    const response = await axios.get(`${cfg.aiBaseUrl}/api/tags`, {
      timeout: 15000,
      headers: { Authorization: `Bearer ${cfg.aiApiKey}` },
    });

    const models = response.data?.models;
    if (!Array.isArray(models)) return [];

    return models
      .filter((m: any) => m && typeof m.name === 'string')
      .map((m: any) => ({ name: m.name, size: m.size }));
  } catch (error) {
    throw toAiChatError(error);
  }
}

/**
 * Проверка доступности AI-сервера и наличия модели
 */
export async function checkAiChatHealth(): Promise<{ ok: boolean; model?: string; error?: string }> {
  try {
    const models = await listAiModels();
    const cfg = getAiBotConfig();
    const found = models.find((m) => m.name === cfg.aiModel);
    return {
      ok: models.length > 0,
      model: found?.name,
      error: models.length > 0 && !found ? `Модель ${cfg.aiModel} не найдена на сервере` : undefined,
    };
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }
}
