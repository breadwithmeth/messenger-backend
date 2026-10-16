// src/integrations/naliv/telegramBotClient.ts
//
// Клиент эндпоинтов бота «Налив» (njt25.naliv.kz/api/telegram-bot/*):
//  - POST /auth/link           — привязка telegram_id к аккаунту по телефону (+ JWT)
//  - POST /auth/unlink         — отвязка
//  - GET  /users/by-telegram/:id — привязан ли пользователь
//  - GET  /users/by-phone/:phone — пользователь по номеру
//  - GET  /users/search?phone= — поиск по частичному номеру
//  - GET  /orders/active?telegram_id= — активные заказы (для уведомлений о статусах)
//  - GET  /orders/:id?telegram_id=    — детали заказа
//
// Авторизация: заголовок X-Bot-Key: <TELEGRAM_BOT_API_KEY>.

import axios from 'axios';
import { createLogger } from '../../config/logging.js';
import { getAiBotConfig } from '../../config/aiBotConfig.js';

const logger = createLogger();

export class NalivBotApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'NalivBotApiError';
  }
}

/** Пользователь «Налив», привязанный к Telegram */
export type NalivLinkedUser = {
  user_id: number;
  name?: string;
  first_name?: string;
  last_name?: string;
  login?: string;
  telegram_id?: string;
  created_at?: string;
};

export type NalivLinkResult = {
  user: NalivLinkedUser;
  token: string;
  sessionToken?: string;
  created: boolean;
};

/** Активный заказ (краткая форма из /orders/active) */
export type NalivActiveOrder = {
  id: number;
  current_status: string | number;
  status_updated_at?: string;
  business?: { id?: number; name?: string; address?: string } | null;
  total_price?: number;
  [key: string]: unknown;
};

function toApiError(error: unknown, endpoint: string): NalivBotApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const message =
      (error.response?.data as any)?.error?.message ||
      (typeof error.response?.data === 'string' ? error.response.data.slice(0, 200) : '') ||
      error.message;
    return new NalivBotApiError(`Naliv bot API ${endpoint} failed: ${message}${status ? ` (HTTP ${status})` : ''}`, status, endpoint);
  }
  return new NalivBotApiError(`Naliv bot API ${endpoint} failed: ${(error as Error).message}`, undefined, endpoint);
}

async function botRequest<T = any>(
  method: 'get' | 'post',
  endpoint: string,
  opts: { params?: Record<string, unknown>; data?: unknown } = {}
): Promise<{ status: number; data: T }> {
  const cfg = getAiBotConfig();

  if (!cfg.nalivBotApiKey) {
    throw new NalivBotApiError('TELEGRAM_BOT_API_KEY не установлен в переменных окружения', undefined, endpoint);
  }

  try {
    const response = await axios.request<T>({
      method,
      url: `${cfg.nalivBaseUrl}${endpoint}`,
      params: opts.params,
      data: opts.data,
      timeout: Math.min(cfg.httpTimeoutMs, 15000),
      headers: {
        'X-Bot-Key': cfg.nalivBotApiKey,
        'Content-Type': 'application/json',
      },
    });
    return { status: response.status, data: response.data };
  } catch (error) {
    throw toApiError(error, endpoint);
  }
}

// === Авторизация ===

/**
 * Привязывает telegram_id к аккаунту по номеру телефона.
 * Пользователь ищется по login (любой формат: 87077770760, 77077770760, +77077707600).
 * Если не найден — создаётся вместе с картой лояльности. Идемпотентен.
 * 409, если telegram_id уже привязан к другому пользователю.
 */
export async function linkTelegramAccount(input: {
  telegram_id: string;
  phone: string;
  telegram_username?: string;
  first_name?: string;
  last_name?: string;
}): Promise<NalivLinkResult> {
  const { data } = await botRequest('post', '/api/telegram-bot/auth/link', { data: input });
  const payload = data?.data;
  if (!payload?.user || !payload?.token) {
    throw new NalivBotApiError('Неожиданный ответ /auth/link', undefined, '/api/telegram-bot/auth/link');
  }
  return {
    user: payload.user,
    token: payload.token,
    sessionToken: payload.session_token,
    created: Boolean(payload.created),
  };
}

/** Отвязывает telegram_id от аккаунта. 404, если привязки нет. */
export async function unlinkTelegramAccount(telegramId: string): Promise<void> {
  await botRequest('post', '/api/telegram-bot/auth/unlink', { data: { telegram_id: telegramId } });
}

/** Привязан ли telegram_id к аккаунту (null — нет) */
export async function getUserByTelegram(telegramId: string): Promise<NalivLinkedUser | null> {
  try {
    const { data } = await botRequest('get', `/api/telegram-bot/users/by-telegram/${encodeURIComponent(telegramId)}`);
    return data?.data ?? null;
  } catch (error) {
    if (error instanceof NalivBotApiError && error.status === 404) return null;
    throw error;
  }
}

/** Пользователь по точному номеру (любой формат), null — не найден */
export async function getUserByPhone(phone: string): Promise<(NalivLinkedUser & { telegram_linked?: boolean }) | null> {
  try {
    const { data } = await botRequest('get', `/api/telegram-bot/users/by-phone/${encodeURIComponent(phone)}`);
    return data?.data ?? null;
  } catch (error) {
    if (error instanceof NalivBotApiError && error.status === 404) return null;
    throw error;
  }
}

// === Заказы ===

/**
 * Активные заказы пользователя за последние 7 дней:
 * UNPAID(66), NEW(0), ACCEPTED(1), READY(2), ON_THE_WAY(3).
 * Пустой список, если пользователь не привязан (404) или заказов нет.
 */
export async function getActiveOrders(telegramId: string): Promise<NalivActiveOrder[]> {
  try {
    const { data } = await botRequest('get', '/api/telegram-bot/orders/active', {
      params: { telegram_id: telegramId },
    });
    return parseActiveOrders(data);
  } catch (error) {
    if (error instanceof NalivBotApiError && error.status === 404) return [];
    throw error;
  }
}

/** Толерантный разбор ответа /orders/active (data — массив или {orders: []}) */
export function parseActiveOrders(payload: any): NalivActiveOrder[] {
  const list = Array.isArray(payload?.data) ? payload.data : Array.isArray(payload?.data?.orders) ? payload.data.orders : [];
  return list.filter((o: any) => o && (o.id !== undefined) && o.current_status !== undefined);
}

/** Детали заказа: позиции, бизнес, статус, история. 403 — чужой заказ. */
export async function getOrderDetails(orderId: number, telegramId: string): Promise<any | null> {
  try {
    const { data } = await botRequest('get', `/api/telegram-bot/orders/${orderId}`, {
      params: { telegram_id: telegramId },
    });
    return data?.data ?? null;
  } catch (error) {
    if (error instanceof NalivBotApiError && (error.status === 404 || error.status === 403)) return null;
    throw error;
  }
}

// === Доставка и создание заказа ===

/** Результат проверки зоны доставки */
export type NalivDeliveryCheck = {
  inZone: boolean;
  deliveryPrice?: number;
  message?: string;
};

/**
 * Проверка зоны и цены доставки (POST /api/delivery/check).
 * Рекомендуется перед созданием заказа: data.in_zone + data.price.
 */
export async function checkDelivery(lat: number, lon: number, businessId: number): Promise<NalivDeliveryCheck> {
  try {
    const { data } = await botRequest('post', '/api/delivery/check', {
      data: { lat, lon, business_id: businessId },
    });
    const d = data?.data ?? data ?? {};
    const inZone = d.in_zone !== undefined ? Boolean(d.in_zone) : Boolean(data?.success);
    const price = Number(d.price ?? d.delivery_price);
    return {
      inZone,
      deliveryPrice: Number.isFinite(price) ? price : undefined,
      message: d.message || data?.message,
    };
  } catch (error) {
    // Вне зоны сервис может отвечать 400 с сообщением
    if (error instanceof NalivBotApiError && error.status === 400) {
      const msg = (error.message.match(/Доставка[^:]*:.*|не в зоне.*/i) || [])[0];
      return { inZone: false, message: msg || undefined };
    }
    throw error;
  }
}

/** Позиция для создания заказа */
export type NalivOrderItemPayload = {
  item_id: number;
  amount: number;
};

/** Тело POST /api/telegram-bot/orders/create */
export type NalivCreateOrderPayload = {
  user_id: number;
  business_id: number;
  items: NalivOrderItemPayload[];
  // Адрес (обязателен для DELIVERY)
  street: string;
  house: string;
  lat: number;
  lon: number;
  apartment?: string;
  entrance?: string;
  floor?: string;
  comment?: string;
  // Опциональные
  delivery_type?: 'DELIVERY' | 'PICKUP' | 'SCHEDULED';
  delivery_date?: string;
  bonus_amount?: number;
  promo_code?: string;
  payment_type_id?: number;
  courier_tips?: number;
  extra?: string;
};

/** Ответ создания заказа (201) */
export type NalivCreatedOrder = {
  order_id: number;
  order_uuid?: string;
  total_sum: number;
  delivery_price: number;
  payment_required: boolean;
  address_id?: number;
  delivery_type?: string;
};

/**
 * Создаёт заказ без онлайн-оплаты от имени пользователя.
 * Цены берутся с сервера (акции применяются автоматически), amount — в штуках.
 */
export async function createNalivOrder(payload: NalivCreateOrderPayload): Promise<NalivCreatedOrder> {
  const { data } = await botRequest('post', '/api/telegram-bot/orders/create', { data: payload });
  const d = data?.data;
  if (!d?.order_id) {
    throw new NalivBotApiError('Неожиданный ответ /orders/create', undefined, '/api/telegram-bot/orders/create');
  }
  return {
    order_id: Number(d.order_id),
    order_uuid: d.order_uuid,
    total_sum: Number(d.total_sum ?? 0),
    delivery_price: Number(d.delivery_price ?? 0),
    payment_required: Boolean(d.payment_required),
    address_id: d.address_id,
    delivery_type: d.delivery_type,
  };
}

// === Статусы ===

/** Человекочитаемые названия статусов активных заказов */
export const ORDER_STATUS_LABELS: Record<string, string> = {
  '66': '⏳ Ожидает оплаты',
  '0': '🆕 Новый',
  '1': '✅ Принят',
  '2': '📦 Готов',
  '3': '🚗 В пути',
};

/** Подпись статуса для уведомления (по коду или имени) */
export function orderStatusLabel(status: string | number): string {
  const key = String(status);
  if (ORDER_STATUS_LABELS[key]) return ORDER_STATUS_LABELS[key];
  const byName = Object.entries(ORDER_STATUS_LABELS).find(([, label]) =>
    label.toLowerCase().includes(key.toLowerCase())
  );
  return byName ? byName[1] : `Статус: ${key}`;
}
