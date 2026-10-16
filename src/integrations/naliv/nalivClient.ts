// src/integrations/naliv/nalivClient.ts
//
// HTTP-клиент публичного API "Налив" (njt25.naliv.kz):
//  - GET /api/addresses/search?query=...   — геокодинг адреса текстом (Photon/OSM, GeoJSON)
//  - GET /api/businesses?page=1&limit=...  — список магазинов с координатами
//  - GET /api/items/search?name=...&business_id=... — поиск товаров магазина
//
// Аутентификация не требуется. Ошибки -> NalivApiError.

import axios, { AxiosInstance } from 'axios';
import { createLogger } from '../../config/logging.js';
import { getAiBotConfig } from '../../config/aiBotConfig.js';
import { NalivAddress, NalivBusiness, NalivBusinessWithDistance, NalivItem } from './types.js';

const logger = createLogger();

export class NalivApiError extends Error {
  constructor(
    message: string,
    public readonly status?: number,
    public readonly endpoint?: string
  ) {
    super(message);
    this.name = 'NalivApiError';
  }
}

const MAX_ADDRESSES = 5;
const BUSINESS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 минут

let http: AxiosInstance | null = null;

function getHttp(): AxiosInstance {
  if (http) return http;

  const cfg = getAiBotConfig();

  http = axios.create({
    baseURL: cfg.nalivBaseUrl,
    timeout: cfg.httpTimeoutMs,
    headers: {
      Accept: 'application/json',
      'User-Agent': 'bm-messenger/1.0',
    },
  });

  // Простой retry с экспоненциальной задержкой
  http.interceptors.response.use(undefined, async (error) => {
    const config = error.config as
      | (typeof error.config & { __nalivRetryCount?: number })
      | undefined;
    const status = error.response?.status;
    const isNetworkError = !error.response;
    const isRetryableStatus = status === 429 || (status !== undefined && status >= 500);

    if (config && (isNetworkError || isRetryableStatus)) {
      const retryCount = config.__nalivRetryCount ?? 0;
      if (retryCount < cfg.httpRetryCount) {
        config.__nalivRetryCount = retryCount + 1;
        const delay = cfg.httpRetryBaseDelayMs * Math.pow(2, retryCount);
        await new Promise((resolve) => setTimeout(resolve, delay));
        return http!.request(config);
      }
    }

    throw error;
  });

  return http;
}

function toApiError(error: unknown, endpoint: string): NalivApiError {
  if (axios.isAxiosError(error)) {
    const status = error.response?.status;
    const detail =
      typeof error.response?.data === 'string'
        ? error.response.data.slice(0, 200)
        : JSON.stringify(error.response?.data ?? {}).slice(0, 200);
    return new NalivApiError(
      `Naliv API ${endpoint} failed: ${error.message}${status ? ` (HTTP ${status})` : ''}${detail ? `: ${detail}` : ''}`,
      status,
      endpoint
    );
  }
  return new NalivApiError(`Naliv API ${endpoint} failed: ${(error as Error).message}`, undefined, endpoint);
}

// === Геокодинг ===

/** Извлекает координаты из GeoJSON FeatureCollection (формат Photon: [lon, lat]) */
export function parseAddressFeatures(payload: any): NalivAddress[] {
  const features = payload?.data?.features;
  if (!Array.isArray(features)) return [];

  const result: NalivAddress[] = [];
  for (const feature of features) {
    const geo = feature?.properties?.geocoding;
    const coords: unknown[] | undefined = feature?.geometry?.coordinates;
    if (!geo || !Array.isArray(coords) || coords.length < 2) continue;

    const lon = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    result.push({
      label: String(geo.label || geo.name || geo.street || 'Неизвестный адрес'),
      lat,
      lon,
      city: geo.city,
      street: geo.street,
      housenumber: geo.housenumber,
    });
    if (result.length >= MAX_ADDRESSES) break;
  }
  return result;
}

/** Ищет адрес текстом, возвращает до 5 кандидатов с координатами */
export async function searchAddresses(query: string): Promise<NalivAddress[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  try {
    const response = await getHttp().get('/api/addresses/search', {
      params: { query: trimmed },
    });
    return parseAddressFeatures(response.data);
  } catch (error) {
    throw toApiError(error, '/api/addresses/search');
  }
}

// === Магазины ===

let businessCache: { data: NalivBusiness[]; expiresAt: number } | null = null;

export function parseBusinesses(payload: any): NalivBusiness[] {
  const list = payload?.data?.businesses;
  if (!Array.isArray(list)) return [];
  return list.filter((b: any) => b && typeof b.id === 'number' && Number.isFinite(b.lat) && Number.isFinite(b.lon));
}

/** Список включённых магазинов (кэш в памяти на 5 минут) */
export async function getBusinesses(): Promise<NalivBusiness[]> {
  if (businessCache && businessCache.expiresAt > Date.now()) {
    return businessCache.data;
  }

  try {
    const response = await getHttp().get('/api/businesses', {
      params: { page: 1, limit: 1000 },
    });
    const businesses = parseBusinesses(response.data).filter((b) => b.enabled === 1);

    businessCache = {
      data: businesses,
      expiresAt: Date.now() + BUSINESS_CACHE_TTL_MS,
    };

    logger.info(`[Naliv] Загружено ${businesses.length} магазинов`);
    return businesses;
  } catch (error) {
    throw toApiError(error, '/api/businesses');
  }
}

export function resetBusinessCache(): void {
  businessCache = null;
}

/**
 * Расстояние между двумя точками по формуле гаверсинуса (метры).
 * Экспортировано для юнит-тестов.
 */
export function haversineDistanceM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // радиус Земли, м
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/** Ближайшие магазины к точке, отсортированные по дистанции */
export async function findNearestBusinesses(
  lat: number,
  lon: number,
  limit: number = 3
): Promise<NalivBusinessWithDistance[]> {
  const businesses = await getBusinesses();

  return businesses
    .map((b) => ({ ...b, distanceM: haversineDistanceM(lat, lon, b.lat, b.lon) }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, Math.max(1, limit));
}

// === Товары ===

export function parseItems(payload: any): NalivItem[] {
  const items = payload?.data?.items;
  if (!Array.isArray(items)) return [];
  return items.filter((i: any) => i && typeof i.item_id === 'number' && i.visible === 1);
}

export type NalivItemSearchResult = {
  businessId: number;
  businessName: string;
  items: NalivItem[];
  total: number;
  page: number;
  totalPages: number;
};

/** Поиск товаров по названию в конкретном магазине */
export async function searchItems(
  name: string,
  businessId: number,
  page: number = 1,
  limit: number = 40
): Promise<NalivItemSearchResult> {
  const trimmed = name.trim();
  if (!trimmed) {
    return { businessId, businessName: '', items: [], total: 0, page: 1, totalPages: 1 };
  }

  try {
    const response = await getHttp().get('/api/items/search', {
      params: { name: trimmed, business_id: businessId, page, limit },
    });

    const business = response.data?.data?.business;
    const pagination = response.data?.data?.pagination;

    return {
      businessId,
      businessName: business?.name || '',
      items: parseItems(response.data),
      total: pagination?.total ?? 0,
      page: pagination?.page ?? page,
      totalPages: pagination?.totalPages ?? 1,
    };
  } catch (error) {
    throw toApiError(error, '/api/items/search');
  }
}
