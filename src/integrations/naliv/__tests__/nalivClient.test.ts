// src/integrations/naliv/__tests__/nalivClient.test.ts

jest.mock('axios', () => {
  const instance = {
    get: jest.fn(),
    request: jest.fn(),
    interceptors: { response: { use: jest.fn() } },
  };
  (globalThis as any).__nalivHttp = instance;
  return {
    __esModule: true,
    default: {
      create: jest.fn(() => instance),
      get: jest.fn(),
      isAxiosError: jest.fn(() => false),
    },
  };
});

import {
  haversineDistanceM,
  parseAddressFeatures,
  parseBusinesses,
  parseItems,
  findNearestBusinesses,
  resetBusinessCache,
} from '../nalivClient.js';

beforeEach(() => {
  resetBusinessCache();
  jest.clearAllMocks();
});

describe('haversineDistanceM', () => {
  test('нулевой дистанции для одинаковых точек', () => {
    expect(haversineDistanceM(49.8, 73.1, 49.8, 73.1)).toBe(0);
  });

  test('расстояние Караганда -> Астана примерно 190-210 км', () => {
    // Караганда: 49.8047, 73.1094; Астана: 51.1694, 71.4491
    const d = haversineDistanceM(49.8047, 73.1094, 51.1694, 71.4491);
    expect(d).toBeGreaterThan(180000);
    expect(d).toBeLessThan(210000);
  });

  test('короткие расстояния в метрах (Бухар-Жырау 70 -> соседний дом)', () => {
    const d = haversineDistanceM(49.799416, 73.090596, 49.7995, 73.091);
    expect(d).toBeGreaterThan(0);
    expect(d).toBeLessThan(100);
  });
});

describe('parseAddressFeatures', () => {
  test('парсит GeoJSON-ответ Photon ([lon, lat])', () => {
    const payload = {
      data: {
        features: [
          {
            type: 'Feature',
            properties: {
              geocoding: {
                label: '70, проспект Бухар-жырау, Караганда',
                city: 'Караганда',
                street: 'проспект Бухар-жырау',
                housenumber: '70',
              },
            },
            geometry: { type: 'Point', coordinates: [73.090678, 49.799367] },
          },
        ],
      },
    };

    const result = parseAddressFeatures(payload);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      label: '70, проспект Бухар-жырау, Караганда',
      lat: 49.799367,
      lon: 73.090678,
      city: 'Караганда',
    });
  });

  test('отбрасывает некорректные фичи и ограничивает до 5', () => {
    const features: any[] = Array.from({ length: 8 }, (_, i) => ({
      properties: { geocoding: { label: `Адрес ${i}` } },
      geometry: { coordinates: [73, 49] },
    }));
    // одна битая фича без координат
    features.push({ properties: { geocoding: { label: 'битая' } }, geometry: {} });

    const result = parseAddressFeatures({ data: { features } });
    expect(result).toHaveLength(5);
    expect(result[0].label).toBe('Адрес 0');
  });

  test('возвращает пустой массив для мусора', () => {
    expect(parseAddressFeatures(null)).toEqual([]);
    expect(parseAddressFeatures({})).toEqual([]);
    expect(parseAddressFeatures({ data: { features: 'nope' } })).toEqual([]);
  });
});

describe('parseBusinesses / parseItems', () => {
  test('оставляет только бизнесы с валидными координатами', () => {
    const businesses = parseBusinesses({
      data: {
        businesses: [
          { id: 1, name: 'Ок', lat: 49.8, lon: 73.1, enabled: 1 },
          { id: 2, name: 'Без координат', enabled: 1 },
          { id: 3, name: 'NaN', lat: 'x', lon: 73.1, enabled: 1 },
        ],
      },
    });
    expect(businesses).toHaveLength(1);
    expect(businesses[0].id).toBe(1);
  });

  test('фильтрует невидимые товары', () => {
    const items = parseItems({
      data: {
        items: [
          { item_id: 1, name: 'Пиво', visible: 1 },
          { item_id: 2, name: 'Скрытый', visible: 0 },
          { item_id: 3, name: 'Без флага' },
        ],
      },
    });
    expect(items).toHaveLength(1);
    expect(items[0].item_id).toBe(1);
  });
});

describe('findNearestBusinesses', () => {
  const getInstance = () => (globalThis as any).__nalivHttp;

  test('возвращает магазины, отсортированные по дистанции', async () => {
    (getInstance().get as jest.Mock).mockResolvedValue({
      data: {
        data: {
          businesses: [
            { id: 1, name: 'Далеко', address: 'Астана', lat: 51.13, lon: 71.38, delivery_service_fee: 30, enabled: 1 },
            { id: 2, name: 'Рядом', address: 'Караганда', lat: 49.7995, lon: 73.0907, delivery_service_fee: 30, enabled: 1 },
            { id: 3, name: 'Средне', address: 'Темиртау', lat: 50.05, lon: 72.96, delivery_service_fee: 30, enabled: 1 },
            { id: 4, name: 'Выключен', address: 'Павлодар', lat: 49.8, lon: 73.1, delivery_service_fee: 30, enabled: 0 },
          ],
        },
      },
    });

    // Точка в Караганде
    const nearest = await findNearestBusinesses(49.7994, 73.0905, 3);

    expect(nearest).toHaveLength(3);
    expect(nearest.map((b) => b.id)).toEqual([2, 3, 1]);
    expect(nearest[0].distanceM).toBeLessThan(500);
    expect(nearest.every((b) => b.distanceM >= 0)).toBe(true);
  });
});
