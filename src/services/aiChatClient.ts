// src/services/aiChatClient.ts
//
// Клиент AI-провайдера для Telegram AI-ботов.
//
// Поддерживаются два стиля API (AI_API_STYLE):
//  - 'glm' (по умолчанию) — Z.ai / Zhipu (OpenAI-совместимый): POST /api/paas/v4/chat/completions
//    * thinking отключён для glm-4.5/4.6 (быстрый ответ без размышлений)
//    * JSON-режим через response_format: { type: 'json_object' }
//  - 'ollama' — нативный Ollama: POST /api/chat (stream: false, format: 'json')
//
// Конфиг: AI_API_STYLE, AI_BOT_BASE_URL, AI_BOT_API_KEY, AI_BOT_MODEL (см. src/config/aiBotConfig.ts)

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

/** Модели glm-4.5/4.6 поддерживают отключение размышлений */
function supportsThinkingToggle(model: string): boolean {
  return /^glm-(4\.5|4\.6)/.test(model);
}

/** Модели glm-5.3+ всегда размышляют — им нужен увеличенный лимит токенов */
function isAlwaysThinkingModel(model: string): boolean {
  return /^glm-(5\.|4\.7)/.test(model);
}

async function chatGlm(
  messages: AiChatMessage[],
  opts: { model?: string; temperature?: number; formatJson?: boolean }
): Promise<string> {
  const cfg = getAiBotConfig();
  const model = opts.model || cfg.aiModel;

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: opts.temperature ?? 0.2,
    max_tokens: isAlwaysThinkingModel(model) ? 2048 : 1024,
  };
  if (opts.formatJson) {
    body.response_format = { type: 'json_object' };
  }
  if (supportsThinkingToggle(model)) {
    body.thinking = { type: 'disabled' };
  }

  const request = (payload: Record<string, unknown>) =>
    axios.post(`${cfg.aiBaseUrl}/api/paas/v4/chat/completions`, payload, {
      timeout: cfg.httpTimeoutMs,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.aiApiKey}`,
      },
    });

  let response;
  try {
    response = await request(body);
  } catch (error) {
    // Модель без поддержки response_format -> повтор без JSON-режима
    if (opts.formatJson && axios.isAxiosError(error) && error.response?.status === 400) {
      const detail = JSON.stringify(error.response?.data ?? {});
      if (/response_format|json_object/i.test(detail)) {
        logger.warn('[AI Client] response_format отклонён, повтор без него');
        const { response_format, ...rest } = body;
        response = await request(rest);
        return extractGlmContent(response);
      }
    }
    // Переопределение модели бота устарело (например qwen на GLM-сервере) -> повтор с моделью из env
    if (opts.model && axios.isAxiosError(error)) {
      const detail = JSON.stringify(error.response?.data ?? {});
      if (/Unknown Model|模型不存在|1211/.test(detail)) {
        logger.warn(`[AI Client] Модель ${model} неизвестна серверу, повтор с ${cfg.aiModel}`);
        response = await request({ ...body, model: cfg.aiModel });
        return extractGlmContent(response);
      }
    }
    throw error;
  }

  return extractGlmContent(response);
}

function extractGlmContent(response: { data?: any }): string {
  const content = response.data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) {
    throw new AiChatError('AI не вернул content в ответе chat/completions');
  }
  return content;
}

async function chatOllama(
  messages: AiChatMessage[],
  opts: { model?: string; temperature?: number; formatJson?: boolean }
): Promise<string> {
  const cfg = getAiBotConfig();
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
}

/**
 * Запрос к чат-модели (без стриминга).
 * @param messages история диалога (system + user/assistant)
 * @param opts.model переопределение модели (по умолчанию AI_BOT_MODEL или aiModel бота)
 * @param opts.temperature температура (по умолчанию 0.2 — важна точность JSON)
 * @param opts.formatJson требовать JSON-вывод
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

  try {
    if (cfg.aiApiStyle === 'ollama') {
      return await chatOllama(messages, opts);
    }
    return await chatGlm(messages, opts);
  } catch (error) {
    if (error instanceof AiChatError) throw error;
    throw toAiChatError(error);
  }
}

/**
 * Список доступных моделей.
 * GLM: GET /api/paas/v4/models; Ollama: GET /api/tags.
 */
export async function listAiModels(): Promise<{ name: string; size?: number }[]> {
  const cfg = getAiBotConfig();

  if (!cfg.aiApiKey) {
    throw new AiChatError('AI_BOT_API_KEY не установлен в переменных окружения');
  }

  try {
    if (cfg.aiApiStyle === 'ollama') {
      const response = await axios.get(`${cfg.aiBaseUrl}/api/tags`, {
        timeout: 15000,
        headers: { Authorization: `Bearer ${cfg.aiApiKey}` },
      });
      const models = response.data?.models;
      if (!Array.isArray(models)) return [];
      return models
        .filter((m: any) => m && typeof m.name === 'string')
        .map((m: any) => ({ name: m.name, size: m.size }));
    }

    const response = await axios.get(`${cfg.aiBaseUrl}/api/paas/v4/models`, {
      timeout: 15000,
      headers: { Authorization: `Bearer ${cfg.aiApiKey}` },
    });
    const models = response.data?.data;
    if (!Array.isArray(models)) return [];
    return models
      .filter((m: any) => m && typeof m.id === 'string')
      .map((m: any) => ({ name: m.id }));
  } catch (error) {
    throw toAiChatError(error);
  }
}

/**
 * Проверка доступности AI-сервера и модели.
 * Наличие модели в списке не гарантировано (например flash-модели Z.ai могут
 * не попадать в /models) — если её там нет, проверяем реальным запросом.
 */
export async function checkAiChatHealth(): Promise<{ ok: boolean; model?: string; error?: string }> {
  const cfg = getAiBotConfig();

  try {
    const models = await listAiModels();
    const found = models.find((m) => m.name === cfg.aiModel);
    if (found) {
      return { ok: true, model: found.name };
    }
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  try {
    await aiChat([{ role: 'user', content: 'ping' }], { temperature: 0 });
    return { ok: true, model: cfg.aiModel };
  } catch (error) {
    return { ok: false, error: `Модель ${cfg.aiModel} недоступна: ${(error as Error).message}` };
  }
}
